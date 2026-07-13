# Requirements Document

## Introduction

This feature refactors the OPC UA Light Server from a hardcoded S7 PLC connector into a plugin-style multi-protocol connector architecture. The system will support multiple industrial communication protocols (S7, Modbus TCP, EtherNet/IP, and future protocols) through a unified interface, a connector registry, generalized database schema, and a protocol-agnostic REST API and Web UI.

## Glossary

- **Connector**: A module that communicates with an industrial device using a specific protocol, implementing the shared Connector_Interface
- **Connector_Interface**: The TypeScript interface that all protocol connectors must implement, defining connection management, polling, value updates, and status reporting
- **Connector_Registry**: The central manager that holds all connector instances, provides lifecycle control, and aggregates status across protocols
- **Connector_Type**: A string discriminator identifying the protocol of a connector (e.g., "s7", "modbus-tcp", "ethernet-ip")
- **Connection_Config**: A protocol-agnostic connection configuration record containing common fields and a JSON params column for protocol-specific settings
- **Mapping**: An association between a protocol-specific device address and an OPC UA node, stored in a generalized mappings table
- **IPC_Bridge**: The component that translates connector value updates into OPC UA node ID messages and forwards them to the runtime process via stdin
- **Value_Update**: A data event emitted by a connector containing a node ID, value, quality indicator, and timestamp
- **Config_Generator**: The module that produces the JSON configuration consumed by the open62541 C runtime
- **Web_UI**: The React-based browser dashboard for administering connectors, connections, and mappings
- **S7_Connector**: The existing Siemens S7 PLC connector refactored to implement the Connector_Interface
- **Modbus_Connector**: A new connector for Modbus TCP devices using the modbus-serial library
- **EthernetIP_Connector**: A new connector for Rockwell EtherNet/IP devices using the ethernet-ip library

## Requirements

### Requirement 1: Shared Connector Interface

**User Story:** As a developer, I want all protocol connectors to implement a shared TypeScript interface, so that the system can manage any connector uniformly regardless of the underlying protocol.

#### Acceptance Criteria

1. THE Connector_Interface SHALL define a `start()` method that initiates all enabled connections for the connector
2. THE Connector_Interface SHALL define a `stop()` method that disconnects all connections and releases resources
3. THE Connector_Interface SHALL define an `addConnection(config: Connection_Config)` method that registers a new connection
4. THE Connector_Interface SHALL define a `removeConnection(id: string)` method that removes a connection and cleans up associated resources
5. THE Connector_Interface SHALL define an `updateConnection(config: Connection_Config)` method that applies configuration changes to an existing connection
6. THE Connector_Interface SHALL define an `addMapping(mapping: Mapping)` method that associates a device address with an OPC UA node
7. THE Connector_Interface SHALL define a `removeMapping(id: string)` method that removes an address-to-node association
8. THE Connector_Interface SHALL define a `getStatus()` method that returns the connection status for all managed connections
9. THE Connector_Interface SHALL define a `getCurrentValues()` method that returns the last-read value for all mapped variables
10. THE Connector_Interface SHALL define an `onValueUpdate(callback)` method that registers a callback to receive batched value updates after each poll cycle
11. THE Connector_Interface SHALL define a `getType()` method that returns the Connector_Type string identifier for the protocol

### Requirement 2: Connector Registry

**User Story:** As the system operator, I want a central registry that manages all connector instances, so that connectors can be started, stopped, and queried as a group.

#### Acceptance Criteria

1. THE Connector_Registry SHALL register connector instances by their Connector_Type
2. THE Connector_Registry SHALL provide a `startAll()` method that starts all registered connectors
3. THE Connector_Registry SHALL provide a `stopAll()` method that stops all registered connectors
4. THE Connector_Registry SHALL provide a `getConnector(type: string)` method that returns the connector instance for a given Connector_Type
5. THE Connector_Registry SHALL provide a `getAggregatedStatus()` method that returns the combined status of all connections across all registered connectors
6. THE Connector_Registry SHALL provide a `getAggregatedValues()` method that returns current values from all registered connectors
7. WHEN a connector emits value updates, THE Connector_Registry SHALL forward the updates to a single registered value update callback

### Requirement 3: Database Schema Migration

**User Story:** As a developer, I want the database schema generalized from S7-specific tables to protocol-agnostic tables, so that any connector type can persist its connections and mappings in a unified structure.

#### Acceptance Criteria

1. THE Database SHALL contain a `connections` table with columns: id (TEXT PK), type (TEXT NOT NULL), name (TEXT NOT NULL), params (TEXT NOT NULL), polling_interval_ms (INTEGER NOT NULL DEFAULT 1000), reconnect_interval_ms (INTEGER NOT NULL DEFAULT 5000), enabled (INTEGER NOT NULL DEFAULT 1), created_at (TEXT NOT NULL)
2. THE Database SHALL contain a `mappings` table with columns: id (TEXT PK), connection_id (TEXT NOT NULL FK), node_id (TEXT NOT NULL FK), device_address (TEXT NOT NULL), description (TEXT), created_at (TEXT NOT NULL)
3. THE Database SHALL enforce a UNIQUE constraint on (connection_id, device_address) in the mappings table
4. THE Database SHALL enforce a UNIQUE constraint on (node_id) in the mappings table to ensure one mapping per OPC UA node
5. WHEN the application starts with existing `s7_connections` and `s7_mappings` tables, THE Database SHALL migrate the data to the new `connections` and `mappings` tables preserving all existing records
6. WHEN migrating S7 connection data, THE Database SHALL set the `type` column to "s7" and store host, rack, and slot in the JSON `params` column
7. WHEN migrating S7 mapping data, THE Database SHALL copy `plc_address` to the `device_address` column

### Requirement 4: Unified REST API

**User Story:** As an API consumer, I want a protocol-agnostic REST API at /api/connectors/*, so that I can manage connections and mappings for any protocol through a single endpoint structure.

#### Acceptance Criteria

1. WHEN a POST request is sent to /api/connectors/connections, THE API SHALL create a new connection with the specified type and params
2. WHEN a GET request is sent to /api/connectors/connections, THE API SHALL return all connections across all connector types
3. WHEN a GET request is sent to /api/connectors/connections with a `type` query parameter, THE API SHALL return only connections matching the specified Connector_Type
4. WHEN a PUT request is sent to /api/connectors/connections/:id, THE API SHALL update the specified connection and notify the corresponding connector of the configuration change
5. WHEN a DELETE request is sent to /api/connectors/connections/:id, THE API SHALL remove the connection and cascade-delete associated mappings
6. WHEN a POST request is sent to /api/connectors/mappings, THE API SHALL create a new mapping for the specified connection
7. WHEN a GET request is sent to /api/connectors/mappings, THE API SHALL return all mappings, optionally filtered by connectionId
8. WHEN a DELETE request is sent to /api/connectors/mappings/:id, THE API SHALL remove the mapping and notify the corresponding connector
9. WHEN a GET request is sent to /api/connectors/status, THE API SHALL return the aggregated connection status from the Connector_Registry
10. WHEN a GET request is sent to /api/connectors/values, THE API SHALL return the current live values from all active connectors
11. WHEN a POST request is sent to /api/connectors/mappings/bulk, THE API SHALL create multiple mappings in a single request with per-item success/failure reporting
12. WHEN a GET request is sent to /api/connectors/mappings/export/csv, THE API SHALL export all mappings as a CSV file with columns: connectionName, type, deviceAddress, nodeName, namespace, description
13. WHEN a POST request is sent to /api/connectors/mappings/import/csv, THE API SHALL import mappings from CSV content, resolving connections and nodes by name

### Requirement 5: Backward-Compatible S7 API

**User Story:** As an existing API consumer, I want the /api/s7/* routes to continue working after the refactor, so that existing integrations remain functional without modification.

#### Acceptance Criteria

1. WHEN a request is sent to any /api/s7/* endpoint, THE API SHALL route the request to the equivalent /api/connectors/* handler with the type fixed to "s7"
2. WHEN creating a connection via /api/s7/connections, THE API SHALL accept the existing S7-specific request body (name, host, rack, slot, pollingIntervalMs, reconnectIntervalMs, enabled) and translate it to the generalized format
3. WHEN returning connections via /api/s7/connections, THE API SHALL format the response in the existing S7-specific shape (flat host, rack, slot fields) for backward compatibility
4. WHEN returning mappings via /api/s7/mappings, THE API SHALL use the field name `plcAddress` instead of `deviceAddress` in the response body

### Requirement 6: S7 Connector Refactor

**User Story:** As a developer, I want the existing S7Connector refactored to implement the Connector_Interface, so that it operates within the new multi-protocol architecture without losing functionality.

#### Acceptance Criteria

1. THE S7_Connector SHALL implement all methods defined in the Connector_Interface
2. THE S7_Connector SHALL return "s7" from the `getType()` method
3. THE S7_Connector SHALL parse the JSON `params` column to extract host, rack, and slot for establishing connections via nodes7
4. THE S7_Connector SHALL maintain existing reconnection behavior with configurable reconnect_interval_ms
5. THE S7_Connector SHALL maintain existing polling behavior with configurable polling_interval_ms
6. THE S7_Connector SHALL emit quality "bad" updates for all mapped nodes when a connection is lost
7. THE S7_Connector SHALL emit quality "good" updates for all mapped nodes when a connection is restored

### Requirement 7: Modbus TCP Connector

**User Story:** As a system integrator, I want a Modbus TCP connector, so that I can read values from Modbus TCP devices and expose them as OPC UA nodes.

#### Acceptance Criteria

1. THE Modbus_Connector SHALL implement all methods defined in the Connector_Interface
2. THE Modbus_Connector SHALL return "modbus-tcp" from the `getType()` method
3. THE Modbus_Connector SHALL parse the JSON `params` column to extract host, port (default 502), and unitId (default 1)
4. WHEN polling, THE Modbus_Connector SHALL read registers from the device at the address specified in the mapping's device_address field
5. THE Modbus_Connector SHALL support device addresses in the format "HR:address:count" for holding registers, "IR:address:count" for input registers, "CO:address" for coils, and "DI:address" for discrete inputs
6. WHEN a connection to a Modbus TCP device fails, THE Modbus_Connector SHALL emit quality "bad" updates and schedule reconnection using the configured reconnect_interval_ms
7. WHEN a connection to a Modbus TCP device is restored, THE Modbus_Connector SHALL resume polling and emit quality "good" updates

### Requirement 8: EtherNet/IP Connector

**User Story:** As a system integrator, I want an EtherNet/IP connector, so that I can read tag values from Rockwell PLCs and expose them as OPC UA nodes.

#### Acceptance Criteria

1. THE EthernetIP_Connector SHALL implement all methods defined in the Connector_Interface
2. THE EthernetIP_Connector SHALL return "ethernet-ip" from the `getType()` method
3. THE EthernetIP_Connector SHALL parse the JSON `params` column to extract host, port (default 44818), and slot (default 0)
4. WHEN polling, THE EthernetIP_Connector SHALL read tag values from the device using the tag name specified in the mapping's device_address field
5. WHEN a connection to an EtherNet/IP device fails, THE EthernetIP_Connector SHALL emit quality "bad" updates and schedule reconnection using the configured reconnect_interval_ms
6. WHEN a connection to an EtherNet/IP device is restored, THE EthernetIP_Connector SHALL resume polling and emit quality "good" updates

### Requirement 9: IPC Bridge Generalization

**User Story:** As the system architect, I want the IPC bridge to work with any connector through the registry, so that value updates from all protocols reach the OPC UA runtime.

#### Acceptance Criteria

1. THE IPC_Bridge SHALL receive value updates from the Connector_Registry rather than directly from a single S7_Connector instance
2. WHEN a Value_Update is received from any connector, THE IPC_Bridge SHALL resolve the node UUID to an OPC UA node ID and write the update to the runtime stdin
3. THE IPC_Bridge SHALL maintain a single cached UUID-to-OPC-UA-ID map shared across all connector types
4. WHEN the address space changes, THE IPC_Bridge SHALL invalidate the cached node ID map

### Requirement 10: Config Generator Updates

**User Story:** As the system architect, I want the config generator to include mappings from all connector types, so that the runtime configuration reflects the complete address space.

#### Acceptance Criteria

1. WHEN generating the runtime configuration, THE Config_Generator SHALL include all node mappings from the generalized `mappings` table regardless of connector type
2. WHEN the address space is modified through any /api/connectors/* endpoint, THE Config_Generator SHALL regenerate the runtime configuration and trigger a hot-reload if the runtime is running

### Requirement 11: Web UI Connectors Screen

**User Story:** As an administrator, I want a unified Connectors screen in the Web UI, so that I can manage connections and mappings for all protocol types from a single interface.

#### Acceptance Criteria

1. THE Web_UI SHALL display a "Connectors" navigation item in the sidebar replacing the existing "S7" item
2. THE Web_UI SHALL display a protocol type selector allowing the user to filter connections by Connector_Type or view all connections
3. WHEN creating a new connection, THE Web_UI SHALL present a protocol type selection step followed by a protocol-specific connection form
4. WHEN the user selects "s7" protocol, THE Web_UI SHALL display fields for name, host, rack, slot, polling interval, and reconnect interval
5. WHEN the user selects "modbus-tcp" protocol, THE Web_UI SHALL display fields for name, host, port, unit ID, polling interval, and reconnect interval
6. WHEN the user selects "ethernet-ip" protocol, THE Web_UI SHALL display fields for name, host, port, slot, polling interval, and reconnect interval
7. THE Web_UI SHALL display connection status (connected, disconnected, error) with color-coded badges for each connection
8. THE Web_UI SHALL display a mapping table for each connection showing device address, mapped OPC UA node, current value, and quality
9. THE Web_UI SHALL support CSV import and export of mappings across all connector types
10. THE Web_UI SHALL support adding and removing individual mappings with protocol-appropriate address input fields

### Requirement 12: Connector Type Extensibility

**User Story:** As a developer, I want to add new protocol connectors in the future without modifying the core system, so that the architecture supports open-ended extension.

#### Acceptance Criteria

1. WHEN a new connector type is implemented, THE Connector_Registry SHALL accept registration of the new connector without changes to existing code
2. THE Web_UI SHALL render a generic connection form for unrecognized connector types using the JSON params field as key-value pairs
3. THE API SHALL accept any Connector_Type string value when creating connections, allowing new types to be persisted before a dedicated connector implementation exists

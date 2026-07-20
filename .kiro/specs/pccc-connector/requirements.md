# Requirements Document

## Introduction

This document defines the requirements for a new PCCC (Programmable Controller Communication Commands) connector in the OPC UA Light Server. PCCC is the legacy protocol used by Allen-Bradley SLC 500, MicroLogix, PLC-5, and older CompactLogix controllers operating in legacy mode. The connector encapsulates PCCC messages over EtherNet/IP (CIP transport), enabling communication with these older PLCs via standard Ethernet networks.

The PCCC connector follows the same multi-protocol connector architecture as the existing S7, Modbus TCP, and EtherNet/IP connectors, implementing the shared `Connector` interface with connection management, periodic polling, automatic reconnection, quality status propagation, and value caching.

## Glossary

- **PCCC_Connector**: The TypeScript class implementing the Connector interface for PCCC-over-EtherNet/IP communication with Allen-Bradley legacy PLCs
- **Connector_Registry**: The central registry that manages all protocol connector instances, provides lifecycle control, and aggregates status and values
- **File_Address**: A PCCC device address using Allen-Bradley file-based addressing notation (e.g., N7:0, F8:1, B3:0/5, T4:0.ACC)
- **Managed_Connection**: An internal object tracking a single PLC connection including its configuration, client instance, state, timers, and associated mappings
- **Polling_Cycle**: A periodic read operation that fetches current values from all mapped file addresses on a connection
- **Quality_Status**: A flag indicating whether a mapped value is reliable ("good") or unreliable due to communication failure ("bad")
- **Value_Update_Callback**: A function registered by the runtime to receive batched value updates after each polling cycle
- **EtherNet_IP_Library**: The `ethernet-ip` npm package which provides PCCC communication support encapsulated over CIP
- **Connection_Config**: The protocol-agnostic configuration object containing id, type, name, params, polling interval, reconnect interval, and enabled flag
- **IPC_Bridge**: The component that forwards connector value updates to the C runtime via stdin pipe

## Requirements

### Requirement 1: PCCC Connector Type Registration

**User Story:** As a system integrator, I want the PCCC connector registered in the Connector Registry, so that I can manage PCCC connections through the same generalized connectors API used for other protocols.

#### Acceptance Criteria

1. THE PCCC_Connector SHALL return "pccc" as its protocol type identifier
2. WHEN the application starts, THE Connector_Registry SHALL have the PCCC_Connector registered and available via `getConnector("pccc")`
3. THE PCCC_Connector SHALL be exported from the connectors barrel module (`src/connectors/index.ts`)

### Requirement 2: Connection Configuration

**User Story:** As a system integrator, I want to configure PCCC connections with host, port, and slot parameters, so that I can connect to different Allen-Bradley legacy PLCs on my network.

#### Acceptance Criteria

1. WHEN a Connection_Config with type "pccc" is provided, THE PCCC_Connector SHALL extract the "host" parameter as a required string
2. WHEN a Connection_Config with type "pccc" is provided, THE PCCC_Connector SHALL extract the "port" parameter as an optional number defaulting to 44818
3. WHEN a Connection_Config with type "pccc" is provided, THE PCCC_Connector SHALL extract the "slot" parameter as an optional number defaulting to 0
4. IF the "host" parameter is missing or empty, THEN THE PCCC_Connector SHALL throw an error indicating that a host parameter is required
5. WHEN a connection with a duplicate id is added, THE PCCC_Connector SHALL throw an error indicating the connection already exists

### Requirement 3: Connection Lifecycle Management

**User Story:** As a system integrator, I want the PCCC connector to manage connection lifecycle (add, remove, update, start, stop), so that I can dynamically configure and control PLC connections without restarting the server.

#### Acceptance Criteria

1. WHEN `start()` is called, THE PCCC_Connector SHALL initiate connections to all enabled Managed_Connections
2. WHEN `start()` is called, THE PCCC_Connector SHALL skip Managed_Connections with `enabled` set to false
3. WHEN `stop()` is called, THE PCCC_Connector SHALL disconnect all Managed_Connections and stop all polling timers
4. WHEN `start()` is called multiple times, THE PCCC_Connector SHALL be idempotent and not create duplicate connections
5. WHEN `stop()` is called multiple times, THE PCCC_Connector SHALL be idempotent and not throw errors
6. WHEN a connection is added while the PCCC_Connector is running and enabled, THE PCCC_Connector SHALL initiate the connection immediately
7. WHEN a connection is added while the PCCC_Connector is running but disabled, THE PCCC_Connector SHALL not initiate the connection
8. WHEN `removeConnection()` is called, THE PCCC_Connector SHALL disconnect the Managed_Connection and release all associated resources
9. WHEN `updateConnection()` is called with an existing id, THE PCCC_Connector SHALL disconnect the old connection and reconnect with the new configuration
10. WHEN `updateConnection()` is called with a non-existing id, THE PCCC_Connector SHALL add it as a new connection

### Requirement 4: PCCC-over-EtherNet/IP Communication

**User Story:** As a system integrator, I want the PCCC connector to communicate with Allen-Bradley PLCs using PCCC messages encapsulated over EtherNet/IP, so that I can read data from SLC 500, MicroLogix, and PLC-5 controllers.

#### Acceptance Criteria

1. WHEN initiating a connection, THE PCCC_Connector SHALL use the EtherNet_IP_Library to establish a PCCC session with the target PLC
2. WHEN a connection is established successfully, THE PCCC_Connector SHALL set the connection state to "connected"
3. IF a connection attempt fails, THEN THE PCCC_Connector SHALL set the connection state to "error" and record the error message
4. WHEN a connection was previously connected and a communication error occurs, THE PCCC_Connector SHALL set the connection state to "disconnected"

### Requirement 5: File-Based Address Mapping

**User Story:** As a system integrator, I want to map PCCC file-based addresses to OPC UA nodes, so that I can expose legacy PLC data files as OPC UA variables.

#### Acceptance Criteria

1. WHEN a mapping is added, THE PCCC_Connector SHALL accept File_Address values using Allen-Bradley file notation (N7:0, F8:1, B3:0/5, T4:0.ACC, C5:0.ACC, S:1, etc.)
2. WHEN a mapping is added for a non-existing connection id, THE PCCC_Connector SHALL throw an error
3. WHEN a mapping is removed, THE PCCC_Connector SHALL stop polling that address and remove it from the value cache
4. IF a mapping is removed with an invalid id, THEN THE PCCC_Connector SHALL throw an error indicating the mapping was not found

### Requirement 6: Periodic Polling

**User Story:** As a system integrator, I want the PCCC connector to periodically read mapped addresses from the PLC, so that OPC UA node values stay up to date with live PLC data.

#### Acceptance Criteria

1. WHEN a connection transitions to "connected", THE PCCC_Connector SHALL begin polling all mapped File_Addresses at the configured polling interval
2. WHEN a Polling_Cycle completes successfully, THE PCCC_Connector SHALL invoke the Value_Update_Callback with batched value updates for all mapped addresses that have a nodeId
3. WHEN a Polling_Cycle completes successfully, THE PCCC_Connector SHALL cache the current value for each mapped address regardless of whether it has a nodeId
4. WHILE no mappings exist for a connection, THE PCCC_Connector SHALL skip polling for that connection
5. WHEN the polling interval elapses, THE PCCC_Connector SHALL execute the next Polling_Cycle

### Requirement 7: Automatic Reconnection

**User Story:** As a system integrator, I want the PCCC connector to automatically reconnect after a communication failure, so that temporary network issues do not require manual intervention.

#### Acceptance Criteria

1. WHEN a connection error occurs, THE PCCC_Connector SHALL schedule a reconnection attempt after the configured reconnect interval
2. WHEN a read error occurs during polling, THE PCCC_Connector SHALL schedule a reconnection attempt after the configured reconnect interval
3. WHILE the PCCC_Connector is stopped, THE PCCC_Connector SHALL not attempt any reconnections
4. WHEN a reconnection attempt succeeds, THE PCCC_Connector SHALL resume polling and emit Quality_Status "good" for all affected mappings

### Requirement 8: Quality Status Propagation

**User Story:** As a system integrator, I want mapped OPC UA nodes to reflect the communication quality, so that client applications can distinguish between live values and stale data from a disconnected PLC.

#### Acceptance Criteria

1. WHEN a connection is established successfully, THE PCCC_Connector SHALL emit Quality_Status "good" for all mappings associated with that connection
2. WHEN a connection error occurs, THE PCCC_Connector SHALL emit Quality_Status "bad" for all mappings associated with that connection
3. WHEN a read error occurs during polling, THE PCCC_Connector SHALL emit Quality_Status "bad" for all mappings associated with that connection
4. WHEN Quality_Status changes, THE PCCC_Connector SHALL update the cached current values to reflect the new quality

### Requirement 9: Status and Value Reporting

**User Story:** As a system integrator, I want to query the current connection statuses and live values of the PCCC connector, so that I can monitor PLC communication health through the REST API.

#### Acceptance Criteria

1. THE PCCC_Connector SHALL report connection status including connectionId, state, lastPollAt, and errorMessage for each Managed_Connection
2. THE PCCC_Connector SHALL report current values including nodeId, deviceAddress, connectionId, value, quality, and timestamp for each cached mapping value
3. WHEN no connections are configured, THE PCCC_Connector SHALL return an empty array for both status and values

### Requirement 10: Unit Test Coverage

**User Story:** As a developer, I want comprehensive unit tests for the PCCC connector, so that I can verify its behavior follows the same patterns as the other connectors and catch regressions.

#### Acceptance Criteria

1. THE unit test suite SHALL verify all connection lifecycle operations (add, remove, update, start, stop)
2. THE unit test suite SHALL verify polling behavior including value emission and interval timing
3. THE unit test suite SHALL verify reconnection logic after connection and read failures
4. THE unit test suite SHALL verify quality status transitions (good on connect, bad on error, good on reconnect)
5. THE unit test suite SHALL use a testable subclass pattern with a mock PCCC client injected via a protected factory method
6. THE unit test suite SHALL reside at `tests/unit/pccc-connector.test.ts`

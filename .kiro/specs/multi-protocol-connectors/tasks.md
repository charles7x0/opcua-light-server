# Implementation Plan: Multi-Protocol Connectors

## Overview

Transform the OPC UA Light Server from a single S7 PLC connector into a pluggable multi-protocol connector system. Implementation proceeds bottom-up: shared types → database migration → repository → registry → connector refactor → new connectors → IPC bridge → API → UI. Each step builds on the previous, with testing woven into implementation tasks.

## Tasks

- [x] 1. Define shared connector types and interfaces
  - [x] 1.1 Create `src/connectors/types.ts` with all shared types
    - Define `ConnectorType`, `ConnectionConfig`, `Mapping`, `ValueUpdate`, `ConnectionStatus`, `CurrentValue`, `ValueUpdateCallback` types
    - Define the `Connector` interface with all 11 methods: `getType()`, `start()`, `stop()`, `addConnection()`, `removeConnection()`, `updateConnection()`, `addMapping()`, `removeMapping()`, `getStatus()`, `getCurrentValues()`, `onValueUpdate()`
    - Export all types as named exports
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [x] 1.2 Create `src/connectors/index.ts` barrel export
    - Re-export all types from `types.ts`
    - Will later re-export `ConnectorRegistry`, individual connectors
    - _Requirements: 1.1–1.11, 12.1_

- [x] 2. Database schema migration (v3 → v4)
  - [x] 2.1 Update `src/db/schema.sql` with new `connections` and `mappings` table definitions
    - Add `connections` table: id, type, name, params, polling_interval_ms, reconnect_interval_ms, enabled, created_at
    - Add `mappings` table: id, connection_id (FK), node_id (FK), device_address, description, created_at with UNIQUE constraints on (connection_id, device_address) and (node_id)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Implement migration v4 in `src/db/database.ts`
    - Add migration logic to detect existing `s7_connections` and `s7_mappings` tables
    - Create `connections` and `mappings` tables
    - Migrate S7 data: set type="s7", compose JSON params from host/rack/slot, copy plc_address to device_address
    - Drop old `s7_connections` and `s7_mappings` tables after migration
    - Record migration version
    - _Requirements: 3.5, 3.6, 3.7_

  - [x] 2.3 Write unit tests for database migration
    - Test fresh database creates new schema correctly
    - Test migration from v3 preserves all S7 connection and mapping records
    - Test params JSON is correctly formed with host, rack, slot
    - Test UNIQUE constraints enforce (connection_id, device_address) and (node_id)
    - _Requirements: 3.1–3.7_

- [x] 3. Implement ConnectorRepository
  - [x] 3.1 Create `src/db/repositories/connector-repository.ts`
    - Implement `createConnection()`, `findAllConnections()`, `findConnectionById()`, `updateConnection()`, `deleteConnection()`
    - Implement `createMapping()`, `findAllMappings()`, `findMappingById()`, `updateMapping()`, `deleteMapping()`, `createMappingsBulk()`
    - Use Result<T> pattern consistent with existing repositories
    - Parse JSON params on read, serialize on write
    - Cascade delete mappings when connection is deleted
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1–4.8, 4.11_

  - [x] 3.2 Write unit tests for ConnectorRepository
    - Test CRUD operations for connections and mappings
    - Test type filter on `findAllConnections()`
    - Test cascade delete of mappings when connection is removed
    - Test UNIQUE constraint violations return proper errors
    - Test bulk mapping creation with mixed success/failure
    - _Requirements: 3.1–3.4, 4.1–4.8, 4.11_

- [x] 4. Implement ConnectorRegistry
  - [x] 4.1 Create `src/connectors/connector-registry.ts`
    - Implement `register()`, `startAll()`, `stopAll()`, `getConnector()`, `getAggregatedStatus()`, `getAggregatedValues()`, `onValueUpdate()`
    - On register, subscribe to connector's `onValueUpdate` and forward updates to the single registered callback
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 4.2 Write unit tests for ConnectorRegistry
    - Test registering multiple connectors by type
    - Test `startAll()`/`stopAll()` invokes each connector
    - Test `getConnector()` returns correct instance or undefined
    - Test value update forwarding from any connector to the registered callback
    - Test aggregated status merges all connector statuses
    - _Requirements: 2.1–2.7_

- [x] 5. Checkpoint - Verify core infrastructure
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Refactor S7Connector to implement Connector interface
  - [x] 6.1 Create `src/connectors/s7/index.ts` implementing the Connector interface
    - Move and adapt existing `src/s7-connector/index.ts` logic into the new location
    - Implement `getType()` returning `"s7"`
    - Adapt `addConnection()` to accept `ConnectionConfig` and extract host/rack/slot from `config.params`
    - Preserve existing reconnection behavior (configurable reconnect_interval_ms)
    - Preserve existing polling behavior (configurable polling_interval_ms)
    - Emit quality "bad" on connection loss, "good" on restoration
    - Keep `getLogs()` method as a protocol-specific extension
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 6.2 Create `src/connectors/s7/types.ts` for S7-specific internal types
    - Move `ManagedConnection`, `NodeS7Instance`, `S7LogEntry` types from old location
    - Keep internal to the S7 connector module
    - _Requirements: 6.3_

  - [x] 6.3 Write unit tests for refactored S7Connector
    - Test `getType()` returns "s7"
    - Test `addConnection()` parses params JSON correctly
    - Test quality "bad" emitted on connection error
    - Test quality "good" emitted on reconnection
    - Adapt existing `tests/unit/s7-connector.test.ts` tests to new interface
    - _Requirements: 6.1–6.7_

- [x] 7. Implement ModbusConnector
  - [x] 7.1 Create `src/connectors/modbus-tcp/index.ts` implementing Connector interface
    - Implement all Connector interface methods
    - Return `"modbus-tcp"` from `getType()`
    - Parse params: host, port (default 502), unitId (default 1)
    - Implement device address parsing: "HR:address:count", "IR:address:count", "CO:address", "DI:address"
    - Implement polling using modbus-serial library (read holding/input registers, coils, discrete inputs)
    - Implement reconnection with configurable interval
    - Emit quality "bad" on failure, "good" on restoration
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 7.2 Create `src/connectors/modbus-tcp/types.ts` for Modbus-specific internal types
    - Define `ModbusAddressType` union: 'HR' | 'IR' | 'CO' | 'DI'
    - Define parsed address structure
    - _Requirements: 7.5_

  - [x] 7.3 Write unit tests for ModbusConnector
    - Test `getType()` returns "modbus-tcp"
    - Test params parsing with defaults (port 502, unitId 1)
    - Test device address format parsing (HR, IR, CO, DI)
    - Test quality updates on connection failure and restoration
    - _Requirements: 7.1–7.7_

- [x] 8. Implement EthernetIPConnector
  - [x] 8.1 Create `src/connectors/ethernet-ip/index.ts` implementing Connector interface
    - Implement all Connector interface methods
    - Return `"ethernet-ip"` from `getType()`
    - Parse params: host, port (default 44818), slot (default 0)
    - Use tag name from device_address field for CIP tag reads
    - Implement polling using ethernet-ip library
    - Implement reconnection with configurable interval
    - Emit quality "bad" on failure, "good" on restoration
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 8.2 Write unit tests for EthernetIPConnector
    - Test `getType()` returns "ethernet-ip"
    - Test params parsing with defaults (port 44818, slot 0)
    - Test quality updates on connection failure and restoration
    - _Requirements: 8.1–8.6_

- [x] 9. Checkpoint - Verify all connectors
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Generalize IPC Bridge
  - [x] 10.1 Create `src/connectors/ipc-bridge.ts` replacing S7-specific IPC logic
    - Accept value updates from ConnectorRegistry (registered as the registry's value update callback)
    - Resolve node UUID to OPC UA node ID using cached map
    - Write JSON updates to runtime stdin via ProcessManager
    - Implement `invalidateMap()` for address space changes
    - Maintain single UUID-to-OPC-UA-ID cache shared across all connector types
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 10.2 Write unit tests for generalized IPC Bridge
    - Test value updates from any connector type are forwarded to runtime
    - Test UUID resolution uses cached map
    - Test `invalidateMap()` clears the cache
    - _Requirements: 9.1–9.4_

- [x] 11. Update Config Generator
  - [x] 11.1 Update `src/config-generator/` to use generalized mappings table
    - Replace `loadS7Mappings()` with `loadMappings()` querying the new `mappings` table joined with `connections`
    - Include all mappings regardless of connector type in generated runtime config
    - Replace `s7Mapping` field with generic `connectorMapping` in NodeConfig (connectionType, connectionHost, deviceAddress)
    - Trigger hot-reload on address space changes from any connector endpoint
    - _Requirements: 10.1, 10.2_

  - [x] 11.2 Write unit tests for updated Config Generator
    - Test that mappings from multiple connector types are included in generated config
    - Test hot-reload triggered on connector mapping changes
    - _Requirements: 10.1, 10.2_

- [x] 12. Implement unified REST API routes
  - [x] 12.1 Create `src/api/routes/connectors.ts` with all /api/connectors/* endpoints
    - POST /connections — create connection (any type)
    - GET /connections — list all connections (optional `?type=` filter)
    - PUT /connections/:id — update connection, notify connector
    - DELETE /connections/:id — delete connection, cascade mappings
    - POST /mappings — create mapping
    - GET /mappings — list mappings (optional `?connectionId=` filter)
    - PUT /mappings/:id — update mapping
    - DELETE /mappings/:id — delete mapping, notify connector
    - POST /mappings/bulk — bulk create with per-item reporting
    - GET /mappings/export/csv — export as CSV (connectionName, type, deviceAddress, nodeName, namespace, description)
    - POST /mappings/import/csv — import from CSV resolving connections/nodes by name
    - GET /status — aggregated status from registry
    - GET /values — current live values from registry
    - Wire router to ConnectorRepository and ConnectorRegistry
    - _Requirements: 4.1–4.13_

  - [x] 12.2 Write unit tests for connectors routes
    - Test connection CRUD with validation
    - Test mapping CRUD with constraint enforcement
    - Test type filter on GET /connections
    - Test cascade delete of mappings
    - Test bulk mapping creation with mixed results
    - Test CSV export format
    - Test CSV import resolution
    - Test status and values endpoints
    - _Requirements: 4.1–4.13_

- [x] 13. Implement S7 backward-compatible alias routes
  - [x] 13.1 Create `src/api/routes/s7-alias.ts`
    - Route all /api/s7/* requests to equivalent /api/connectors/* handlers with type fixed to "s7"
    - Translate incoming S7-specific body (flat host, rack, slot) to generalized format (type: "s7", params: { host, rack, slot })
    - Translate outgoing responses back to S7-specific shape (flat host, rack, slot fields)
    - Use `plcAddress` instead of `deviceAddress` in mapping responses
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 13.2 Write unit tests for S7 alias routes
    - Test POST /api/s7/connections translates body correctly
    - Test GET /api/s7/connections returns flat S7 shape
    - Test GET /api/s7/mappings uses `plcAddress` field name
    - Test all S7 endpoints work identically to before refactor
    - _Requirements: 5.1–5.4_

- [x] 14. Wire application startup and register routes
  - [x] 14.1 Update `src/api/app.ts` and `src/api/server.ts`
    - Instantiate ConnectorRepository, ConnectorRegistry, IpcBridge
    - Register S7Connector, ModbusConnector, EthernetIPConnector in the registry
    - Load connections and mappings from DB into connectors on startup
    - Register value update callback from IPC Bridge on the registry
    - Mount `/api/connectors` router and `/api/s7` alias router
    - Call `registry.startAll()` on server start
    - Call `registry.stopAll()` on server shutdown
    - Remove old S7-specific wiring code
    - _Requirements: 2.1–2.7, 9.1, 12.1_

  - [x] 14.2 Write integration test for multi-connector startup
    - Test that all three connectors are registered
    - Test that DB connections are loaded into correct connectors
    - Test that value updates flow from connectors through registry to IPC bridge
    - _Requirements: 2.1–2.7, 9.1_

- [x] 15. Checkpoint - Verify backend integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Web UI - Connectors screen
  - [x] 16.1 Create `web/src/screens/connectors/ConnectorsManager.tsx`
    - Top-level screen component with protocol filter tabs (All, S7, Modbus TCP, EtherNet/IP)
    - Fetch connections from /api/connectors/connections using TanStack Query
    - Display connection cards grouped/filtered by type
    - Add "New Connection" button triggering protocol selection flow
    - _Requirements: 11.1, 11.2_

  - [x] 16.2 Create `web/src/screens/connectors/ProtocolSelector.tsx`
    - Protocol type picker with options: S7, Modbus TCP, EtherNet/IP
    - Rendered as first step when creating a new connection
    - _Requirements: 11.3_

  - [x] 16.3 Create `web/src/screens/connectors/ConnectionForm.tsx`
    - Protocol-aware form with dynamic fields based on selected type
    - S7: name, host, rack, slot, polling interval, reconnect interval
    - Modbus TCP: name, host, port, unit ID, polling interval, reconnect interval
    - EtherNet/IP: name, host, port, slot, polling interval, reconnect interval
    - Generic fallback: key-value pairs for unrecognized types
    - _Requirements: 11.4, 11.5, 11.6, 12.2_

  - [x] 16.4 Create `web/src/screens/connectors/ConnectionCard.tsx`
    - Display connection name, type badge, status badge (connected/disconnected/error with color coding)
    - Expand/collapse to show mapping table
    - Edit and delete actions
    - _Requirements: 11.7, 11.8_

  - [x] 16.5 Create `web/src/screens/connectors/MappingTable.tsx`
    - Display mappings for a connection: device address, mapped OPC UA node, current value, quality badge
    - Add mapping button with protocol-appropriate address input
    - Remove mapping button
    - _Requirements: 11.8, 11.10_

  - [x] 16.6 Create `web/src/screens/connectors/CsvImportExport.tsx`
    - Export button triggering GET /api/connectors/mappings/export/csv download
    - Import button with file picker and POST /api/connectors/mappings/import/csv
    - Display import results (success/failure per row)
    - _Requirements: 11.9_

  - [x] 16.7 Update navigation and routing
    - Replace "S7" nav item with "Connectors" in sidebar (`web/src/layout/`)
    - Update route configuration to render ConnectorsManager
    - Remove old S7 screen route (keep files for reference until alias routes confirmed working)
    - _Requirements: 11.1_

  - [x] 16.8 Write component tests for Connectors screen
    - Test ConnectorsManager renders connection cards
    - Test ProtocolSelector emits selected type
    - Test ConnectionForm renders correct fields per protocol type
    - Test ConnectionCard shows status badge with correct color
    - Test MappingTable displays device address and live values
    - _Requirements: 11.1–11.10_

- [x] 17. Final checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design does not include a Correctness Properties section, so property-based tests are not included as separate tasks. Unit tests and integration tests cover validation.
- New npm dependencies required: `modbus-serial` (for ModbusConnector) and `ethernet-ip` (for EthernetIPConnector)
- The old `src/s7-connector/` directory can be removed after task 6 is complete and tests pass
- The old `src/db/repositories/s7-repository.ts` is superseded by `connector-repository.ts` but should remain until S7 alias routes are confirmed working

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1"] },
    { "id": 3, "tasks": ["2.3", "3.1", "4.2"] },
    { "id": 4, "tasks": ["3.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1", "7.2", "8.1"] },
    { "id": 6, "tasks": ["7.3", "8.2", "10.1"] },
    { "id": 7, "tasks": ["10.2", "11.1"] },
    { "id": 8, "tasks": ["11.2", "12.1"] },
    { "id": 9, "tasks": ["12.2", "13.1"] },
    { "id": 10, "tasks": ["13.2", "14.1"] },
    { "id": 11, "tasks": ["14.2"] },
    { "id": 12, "tasks": ["16.1", "16.2"] },
    { "id": 13, "tasks": ["16.3", "16.4", "16.5"] },
    { "id": 14, "tasks": ["16.6", "16.7"] },
    { "id": 15, "tasks": ["16.8"] }
  ]
}
```

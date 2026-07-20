# Implementation Plan: PCCC Connector

## Overview

Add a PCCC (Programmable Controller Communication Commands) connector to the OPC UA Light Server, enabling communication with Allen-Bradley legacy PLCs (SLC 500, MicroLogix, PLC-5) over EtherNet/IP. The implementation follows the same architecture as the existing EtherNet/IP, S7, and Modbus TCP connectors — implementing the shared `Connector` interface with the testable subclass pattern.

## Tasks

- [x] 1. Set up project dependencies and type registration
  - [x] 1.1 Add `nodepccc` dependency to package.json
    - Run `npm install nodepccc` to add the library
    - Verify the package installs correctly
    - _Requirements: 4.1_

  - [x] 1.2 Add 'pccc' to the ConnectorType union and export PcccConnector from barrel
    - In `src/connectors/types.ts`, add `'pccc'` to the `ConnectorType` union type
    - In `src/connectors/index.ts`, add `export { PcccConnector } from './pccc/index.js'`
    - _Requirements: 1.1, 1.3_

- [x] 2. Implement PcccConnector class
  - [x] 2.1 Create `src/connectors/pccc/index.ts` with core class structure
    - Create the `PcccConnector` class implementing the `Connector` interface
    - Define `ManagedPcccConnection` interface with all fields (config, host, port, slot, routing, plc, state, lastPollAt, errorMessage, pollingTimer, reconnectTimer, pollInProgress, mappings, connecting)
    - Define `PcccParams` interface (host, port, slot, routing)
    - Implement `getType()` returning `'pccc'`
    - Implement `onValueUpdate()` to store the callback
    - Implement `extractParams()` — host required, port defaults to 44818, slot defaults to 0, routing optional
    - Implement `protected createPLC()` factory method returning a new nodepccc instance
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Implement connection lifecycle methods (addConnection, removeConnection, updateConnection)
    - `addConnection`: validate params, create ManagedPcccConnection, store in map, initiate if running and enabled
    - `removeConnection`: disconnect, clear timers, remove from map
    - `updateConnection`: disconnect old, apply new config, reconnect if running and enabled; add as new if id not found
    - Throw appropriate errors for duplicate ids, missing host param
    - _Requirements: 3.1, 3.2, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 2.3 Implement start/stop with idempotency
    - `start()`: set `running = true`, initiate all enabled connections; skip if already running
    - `stop()`: set `running = false`, disconnect all, clear all timers; skip if already stopped
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.4 Implement connection initiation using nodepccc
    - `initiateConnection()`: guard with `connecting` flag, create PLC via `createPLC()`, call `setTranslationCB` for pass-through addressing, call `initiateConnection({host, port, routing}, callback)`
    - On success: set state to "connected", emit quality "good", start polling
    - On failure: set state to "error", record error message, emit quality "bad", schedule reconnect
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.5 Implement address validation and mapping methods (addMapping, removeMapping)
    - Validate PCCC file-based addresses using regex: `/^([A-Z]{1,2})(\d+)?:(\d+)(\/(\d+|DN|EN|TT|ACC|PRE|LEN|POS|CU|CD|OV|UN|UA))?(\.\w+)?(,\d+)?$/i`
    - `addMapping`: validate connectionId exists, validate address format, register address with nodepccc via `addItems()`, store mapping
    - `removeMapping`: find mapping, call `removeItems()`, remove from cache, throw if not found
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.6 Implement polling logic (startPolling, pollAddresses, stopPolling)
    - `startPolling()`: set up `setInterval` at configured rate, perform initial poll
    - `pollAddresses()`: guard with `pollInProgress`, call `readAllItems(callback)`, iterate mappings calling `findItem()` for each
    - Cache ALL mapping values regardless of nodeId; emit via callback ONLY for mappings with non-null nodeId
    - Handle partial bad quality (individual items) vs all-bad (connection loss)
    - `stopPolling()`: clear interval timer
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 2.7 Implement reconnection logic
    - `scheduleReconnect()`: clear existing timer, set timeout for `reconnectIntervalMs`, on elapsed create new PLC and call `initiateConnection()`
    - Guard: skip if `running === false`, skip if `connecting === true`
    - On reconnect success: emit quality "good", restart polling
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.8 Implement quality status propagation and status/value reporting
    - `emitQualityUpdate()`: update cached values quality, emit ValueUpdate for all mappings with non-null nodeId
    - `getStatus()`: return ConnectionStatus[] with connectionId, state, lastPollAt, errorMessage
    - `getCurrentValues()`: return CurrentValue[] from cache
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_

- [x] 3. Checkpoint - Verify connector compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Register PcccConnector in server startup
  - [x] 4.1 Register PcccConnector in `src/api/server.ts`
    - Import `PcccConnector` from connectors barrel
    - Instantiate `new PcccConnector()`
    - Register with `connectorRegistry.register(pcccConnector)`
    - Follows the same pattern as S7, Modbus, and EtherNet/IP registration
    - _Requirements: 1.2_

- [x] 5. Write unit tests
  - [x] 5.1 Create `tests/unit/pccc-connector.test.ts` with testable subclass and helpers
    - Create `TestablePcccConnector` extending `PcccConnector`, overriding `createPLC()` to return a mock
    - Create `createMockPLC()` function with mock `initiateConnection`, `dropConnection`, `setTranslationCB`, `addItems`, `removeItems`, `readAllItems`, `findItem` methods
    - Create `createConnectionConfig()` and `createMapping()` helper factories
    - _Requirements: 10.5_

  - [x] 5.2 Write unit tests for type identification and parameter extraction
    - Test `getType()` returns "pccc"
    - Test host extraction (required), port default (44818), slot default (0), routing (optional)
    - Test error thrown when host missing
    - Test error thrown for duplicate connection id
    - _Requirements: 10.1, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.3 Write unit tests for connection lifecycle (add, remove, update, start, stop)
    - Test addConnection stores configuration, immediate initiation when running
    - Test removeConnection disconnects and cleans up
    - Test updateConnection disconnects old and reconnects with new config
    - Test start/stop idempotency
    - Test disabled connections are skipped
    - _Requirements: 10.1, 3.1–3.10_

  - [x] 5.4 Write unit tests for polling behavior
    - Test polling starts after successful connection
    - Test value updates emitted with correct nodeId, value, quality
    - Test no polling when no mappings exist
    - Test polling at configured interval
    - _Requirements: 10.2, 6.1–6.5_

  - [x] 5.5 Write unit tests for reconnection logic
    - Test reconnect scheduled after connection error
    - Test reconnect scheduled after read error
    - Test no reconnect when connector stopped
    - Test quality "good" emitted on successful reconnection
    - _Requirements: 10.3, 7.1–7.4_

  - [x] 5.6 Write unit tests for quality status transitions
    - Test quality "good" on successful connection
    - Test quality "bad" on connection failure
    - Test quality "bad" on read error
    - Test quality "good" on reconnection
    - Test cache reflects quality changes
    - _Requirements: 10.4, 8.1–8.4_

  - [x] 5.7 Write unit tests for status and value reporting
    - Test getStatus() returns correct shape with connectionId, state, lastPollAt, errorMessage
    - Test getCurrentValues() returns correct shape with nodeId, deviceAddress, connectionId, value, quality, timestamp
    - Test empty arrays when no connections/values configured
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 6. Checkpoint - Ensure all unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write property-based tests
  - [x] 7.1 Write property test: Only enabled connections are initiated on start
    - **Property 1: Only enabled connections are initiated on start**
    - Generate arrays of ConnectionConfig with random `enabled` flags using fast-check
    - Assert that `initiateConnection` is called only for configs where `enabled === true`
    - **Validates: Requirements 3.1, 3.2**

  - [x] 7.2 Write property test: Start and stop are idempotent
    - **Property 2: Start and stop are idempotent**
    - Generate random sequences of start/stop calls (N starts, M stops)
    - Assert no errors thrown and observable state is same as single call
    - **Validates: Requirements 3.4, 3.5**

  - [x] 7.3 Write property test: Connection state transitions are correct
    - **Property 3: Connection state transitions are correct**
    - Generate sequences of connect success/failure events
    - Assert state is "connected" on success, "error" on first failure, "disconnected" on failure after connected
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [x] 7.4 Write property test: Valid PCCC file addresses are accepted
    - **Property 4: Valid PCCC file addresses are accepted**
    - Generate valid PCCC addresses from grammar: file type (N,F,B,T,C,S,L,O,I,R,ST) × file number × element × optional sub-parts
    - Assert `addMapping()` succeeds without error for all generated addresses
    - **Validates: Requirements 5.1**

  - [x] 7.5 Write property test: Poll results are correctly partitioned
    - **Property 5: Poll results are correctly partitioned**
    - Generate arrays of Mapping with random nodeId presence (some null, some non-null)
    - Assert all mappings cached, but only non-null nodeId mappings emitted via callback
    - **Validates: Requirements 6.2, 6.3**

  - [x] 7.6 Write property test: Successful connection emits quality "good" for all mappings
    - **Property 7: Successful connection emits quality "good" for all mappings**
    - Generate random mapping counts (1-20) with non-null nodeIds
    - Assert quality "good" emitted for every mapping on connection success
    - **Validates: Requirements 7.4, 8.1**

  - [x] 7.7 Write property test: Connection or read error emits quality "bad" for all mappings
    - **Property 8: Connection or read error emits quality "bad" for all mappings**
    - Generate random mapping counts (1-20) with non-null nodeIds
    - Assert quality "bad" emitted for every mapping on connection/read error
    - **Validates: Requirements 8.2, 8.3**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The testable subclass pattern (overriding `createPLC()`) matches the EthernetIPConnector test approach
- All PCCC file-based addresses are passed through to nodepccc via `setTranslationCB` — validation is at mapping time only

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5"] },
    { "id": 4, "tasks": ["2.6", "2.7"] },
    { "id": 5, "tasks": ["2.8"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7"] },
    { "id": 9, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7"] }
  ]
}
```

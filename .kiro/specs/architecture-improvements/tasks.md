# Implementation Plan: Architecture Improvements

## Overview

Internal refactoring to eliminate code duplication, unify error handling patterns, improve observability, reduce coupling in the entry point, and strengthen type safety. All changes are behavior-preserving — no external API changes.

## Tasks

- [x] 1. Extract shared CSV utilities
  - [x] 1.1 Create `src/utils/csv.ts` with `escapeCsvField` and `parseCsvLine`
    - Extract the existing implementations from `src/api/routes/nodes.ts`
    - Export both functions as named exports
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Update `src/api/routes/nodes.ts` to use shared CSV utilities
    - Remove local `escapeCsvField` and `parseCsvLine` functions
    - Import from `../../utils/csv.js`
    - _Requirements: 1.4, 1.5_

  - [x] 1.3 Update `src/api/routes/s7.ts` to use shared CSV utilities
    - Remove local `escapeCsvField` and `parseCsvLine` functions
    - Import from `../../utils/csv.js`
    - _Requirements: 1.4, 1.5_

- [x] 2. Create shared Result type and unify NodeRepository error handling
  - [x] 2.1 Create `src/types/result.ts` with `Result<T>` and `DomainError` types
    - Define `DomainErrorCode` union, `DomainError` interface, and `Result<T>` discriminated union
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Migrate `NodeRepository.create()` to return `Result<OpcUaNode>`
    - Replace thrown errors with Result returns
    - Keep `findAll` and `findById` signatures unchanged
    - _Requirements: 2.3_

  - [x] 2.3 Migrate `NodeRepository.update()` to return `Result<OpcUaNode>`
    - Replace thrown errors with Result returns
    - _Requirements: 2.3_

  - [x] 2.4 Migrate `NodeRepository.delete()` to return `Result<void>`
    - Replace boolean return with Result pattern
    - _Requirements: 2.4_

  - [x] 2.5 Update `src/api/routes/nodes.ts` to handle Result pattern
    - Replace try/catch + property inspection with `if (!result.success)` checks
    - Map error codes to HTTP status codes consistently
    - _Requirements: 2.6, 2.7_

- [x] 3. Consistent logging across all modules
  - [x] 3.1 Update `TofuManager` to use `logService`
    - Replace all `console.log`, `console.warn`, `console.error` with logService calls
    - Use source 'TofuManager'
    - _Requirements: 3.1, 3.4_

  - [x] 3.2 Update `ConfigGenerator` to use `logService`
    - Replace `console.warn` calls with `logService.warn`
    - Use source 'ConfigGenerator'
    - _Requirements: 3.2, 3.4_

  - [x] 3.3 Update `server.ts` to use `logService` for key events
    - Add logService calls alongside existing console output for startup, shutdown, and errors
    - Use source 'Server'
    - _Requirements: 3.3, 3.4, 3.5_

- [x] 4. Extract S7 IPC Bridge
  - [x] 4.1 Create `src/s7-connector/ipc-bridge.ts` with `S7IpcBridge` class
    - Move UUID→OPC UA node ID map logic from server.ts
    - Accept ConfigGenerator, ProcessManager, Database, and logService as dependencies
    - Expose `handleValueUpdates` method and `invalidateMap` method
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

  - [x] 4.2 Update `server.ts` to use `S7IpcBridge`
    - Replace inline IPC wiring with S7IpcBridge instantiation
    - Pass `bridge.handleValueUpdates.bind(bridge)` as the onValueUpdate callback
    - _Requirements: 4.5, 4.7_

- [x] 5. Type the nodes7 client in S7 Connector
  - [x] 5.1 Update `ManagedConnection.client` type
    - Change from `any` to the proper nodes7 type from the declaration file
    - Update `createNodeS7Instance()` return type
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Config Generator repository injection
  - [x] 6.1 Add optional repository parameters to ConfigGenerator constructor
    - Accept `NamespaceRepository` and `NodeRepository` as optional dependencies
    - Use them in `buildNamespaces` and `buildNodes` where applicable
    - Keep direct DB queries for complex joins
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Update `server.ts` and `app.ts` to pass repositories to ConfigGenerator
    - Pass the already-instantiated repositories
    - _Requirements: 6.1_

- [x] 7. Database cache invalidation on writes
  - [x] 7.1 Add `clearCache()` call after successful writes in `Database.write()`
    - Clear all cache entries after writeFn returns successfully
    - Do not clear on error
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 8. Verification checkpoint
  - [x] 8.1 Run full test suite to confirm no regressions
    - Run `npm test -- --silent` and verify all tests pass
    - _Requirements: 1.5, 2.7, 4.7, 5.3, 6.4, 7.4_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "3.2", "7.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "2.3", "2.4", "3.3", "5.1"] },
    { "id": 2, "tasks": ["2.5", "4.1", "6.1"] },
    { "id": 3, "tasks": ["4.2", "6.2"] },
    { "id": 4, "tasks": ["8.1"] }
  ]
}
```

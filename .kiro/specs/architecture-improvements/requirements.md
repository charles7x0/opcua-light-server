# Requirements Document

## Introduction

Architecture improvements to the OPC UA Light Server Control API codebase. Addresses code duplication, inconsistent patterns, tight coupling, and observability gaps identified during a comprehensive architecture review. These changes are internal refactors that do not alter external API behavior or add new features.

## Glossary

- **CSV_Utils**: A shared utility module providing RFC 4180-compliant CSV parsing and serialization functions.
- **Result_Pattern**: A discriminated union type `{ success: true, data: T } | { success: false, error: DomainError }` for explicit error handling without exceptions.
- **DomainError**: A typed error object with `code`, `message`, and optional `details` fields, replacing ad-hoc error properties.
- **S7_IPC_Bridge**: A module that translates S7 Connector value updates (using database UUIDs) into OPC UA node IDs and forwards them to the runtime via stdin IPC.
- **LogService**: The centralized in-memory logging service exposed via `GET /api/logs`.

## Requirements

### Requirement 1: Shared CSV Utilities

**User Story:** As a developer, I want CSV parsing and serialization in a single shared module, so that bugfixes and enhancements apply consistently across all import/export endpoints.

#### Acceptance Criteria

1. THERE SHALL exist a shared module at `src/utils/csv.ts` exporting `escapeCsvField` and `parseCsvLine` functions.
2. THE `escapeCsvField` function SHALL wrap fields containing commas, double quotes, newlines, or carriage returns in double quotes, escaping internal double quotes by doubling them (RFC 4180).
3. THE `parseCsvLine` function SHALL parse a single CSV line respecting quoted fields, escaped quotes, and return an array of field strings.
4. THE route modules `src/api/routes/nodes.ts` and `src/api/routes/s7.ts` SHALL import CSV utilities from `src/utils/csv.ts` instead of defining local implementations.
5. AFTER refactoring, all existing CSV export and import API behaviors SHALL remain unchanged (no regression).

### Requirement 2: Unified Repository Error Handling

**User Story:** As a developer, I want all repositories to use the same Result pattern for error handling, so that route handlers have a consistent interface and don't need type-assertion hacks.

#### Acceptance Criteria

1. THERE SHALL exist a shared Result type at `src/types/result.ts` defining `Result<T>` as `{ success: true; data: T } | { success: false; error: DomainError }`.
2. THE `DomainError` type SHALL contain fields: `code` (string union of known error codes), `message` (string), and optional `details` (array of `{ field: string; message: string }`).
3. THE `NodeRepository` SHALL return `Result<OpcUaNode>` from `create()` and `update()` methods instead of throwing errors with ad-hoc properties.
4. THE `NodeRepository.delete()` SHALL return `Result<void>` instead of a boolean.
5. THE `NodeRepository.findById()` return type SHALL remain `OpcUaNode | null` (no change needed for queries).
6. THE route handler in `src/api/routes/nodes.ts` SHALL be updated to handle the Result pattern instead of try/catch with property inspection.
7. AFTER refactoring, all existing Node API behaviors (status codes, response bodies, error formats) SHALL remain unchanged.

### Requirement 3: Consistent Logging

**User Story:** As an operator, I want all system events visible through the log API, so that the web dashboard provides complete operational visibility without needing access to stdout.

#### Acceptance Criteria

1. THE `TofuManager` class SHALL use `logService` for all logging instead of `console.log`, `console.warn`, and `console.error`.
2. THE `ConfigGenerator` class SHALL use `logService` for warning messages instead of `console.warn`.
3. THE `server.ts` entry point SHALL use `logService` for startup, shutdown, and error messages in addition to any console output needed for immediate process visibility.
4. ALL log calls SHALL include a descriptive `source` parameter (e.g., 'TofuManager', 'ConfigGenerator', 'Server').
5. AFTER refactoring, the log entries SHALL be queryable via `GET /api/logs` with appropriate level and source filters.

### Requirement 4: S7 IPC Bridge Extraction

**User Story:** As a developer, I want the S7-to-runtime IPC logic in its own module, so that it can be tested in isolation and the server entry point remains focused on bootstrapping.

#### Acceptance Criteria

1. THERE SHALL exist a module at `src/s7-connector/ipc-bridge.ts` exporting a class `S7IpcBridge`.
2. THE `S7IpcBridge` SHALL accept `ConfigGenerator`, `ProcessManager`, `Database`, and `LogService` as constructor dependencies.
3. THE `S7IpcBridge` SHALL expose a `handleValueUpdates(updates: S7ValueUpdate[])` method that resolves UUID node IDs to OPC UA node IDs and writes the JSON message to the runtime's stdin.
4. THE `S7IpcBridge` SHALL lazily build and cache a UUID→OPC UA node ID map, rebuilding it when an unknown UUID is encountered.
5. THE `server.ts` entry point SHALL instantiate `S7IpcBridge` and pass its `handleValueUpdates` method as the S7 Connector's `onValueUpdate` callback.
6. THE `S7IpcBridge` SHALL use `logService` for all diagnostic logging (with source 'S7-IPC').
7. AFTER refactoring, S7 value updates SHALL continue to flow from PLC to runtime identically to the current behavior.

### Requirement 5: Typed nodes7 Client

**User Story:** As a developer, I want the S7 Connector to use proper TypeScript types for the nodes7 client instance, so that method calls are type-checked at compile time.

#### Acceptance Criteria

1. THE `ManagedConnection` interface in `src/s7-connector/index.ts` SHALL type the `client` field using the declared module type from `src/types/nodes7.d.ts` instead of `any`.
2. THE `createNodeS7Instance()` method return type SHALL match the typed nodes7 interface.
3. AFTER refactoring, the S7 Connector SHALL compile without type errors and all existing tests SHALL pass.

### Requirement 6: Config Generator Repository Injection

**User Story:** As a developer, I want the Config Generator to use repository methods for data access, so that schema changes only need to be updated in one place.

#### Acceptance Criteria

1. THE `ConfigGenerator` constructor SHALL accept repository dependencies (`NodeRepository`, `NamespaceRepository`, `S7Repository`) in addition to the `Database` instance.
2. THE `ConfigGenerator.generate()` method SHALL use repository methods for retrieving namespaces, nodes, and S7 mappings where equivalent repository methods exist.
3. THE `ConfigGenerator` MAY still use direct DB queries for joins or aggregations not available through existing repository interfaces (e.g., the S7 mapping join with connection host).
4. AFTER refactoring, the generated configuration JSON SHALL be byte-equivalent to the current output for the same database state.

### Requirement 7: Cache Invalidation

**User Story:** As a developer, I want the database cache to be invalidated after write operations, so that subsequent reads always return fresh data.

#### Acceptance Criteria

1. THE `Database.write()` method SHALL clear all cache entries after a successful write operation completes.
2. THE cache clearing SHALL occur after the write function returns successfully, not before.
3. IF the write function throws an error, THE cache SHALL NOT be cleared (preserving the last known good state).
4. AFTER refactoring, all existing read and write behaviors SHALL remain unchanged, with the only observable difference being that reads after writes always reflect the latest state.

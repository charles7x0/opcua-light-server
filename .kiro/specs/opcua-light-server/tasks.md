# Implementation Plan: OPC UA Light Server

## Overview

This plan implements a lightweight OPC UA server system with three tiers: a Node.js/Express Control API with SQLite persistence, an open62541 C runtime managed as a child process, and a React web UI. Implementation proceeds bottom-up: data layer first, then API logic, then runtime integration, then the web UI, and finally the optional S7 connector.

## Tasks

- [x] 1. Project setup and core infrastructure
  - [x] 1.1 Initialize Node.js project and install dependencies
    - Initialize `package.json` with TypeScript, Express, better-sqlite3, uuid, vitest, fast-check, React, and React Query
    - Configure `tsconfig.json` for Node.js backend and React frontend
    - Set up Vitest configuration with separate test paths for unit, property, and integration tests
    - Create directory structure: `src/api/`, `src/db/`, `src/process-manager/`, `src/config-generator/`, `src/s7-connector/`, `src/auth/`, `web/`, `tests/`, `runtime/`
    - _Requirements: 10.1_

  - [x] 1.2 Define TypeScript domain types and interfaces
    - Create `src/types/index.ts` with all domain types: `OpcUaDataType`, `OpcUaNode`, `Namespace`, `Folder`, `SecurityConfig`, `ServerStatus`, `S7ConnectionConfig`, `S7Mapping`, `S7ConnectionStatus`
    - Create `src/types/api.ts` with request/response DTOs and error response format
    - Create `src/types/config.ts` with `AddressSpaceConfig`, `NamespaceConfig`, `FolderConfig`, `NodeConfig` interfaces for the runtime JSON contract
    - _Requirements: 1.1, 2.1, 3.1, 5.3, 6.1, 7.1, 7.2_

  - [x] 1.3 Implement SQLite schema and migration system
    - Create `src/db/schema.sql` with all tables: `schema_migrations`, `namespaces`, `folders`, `nodes`, `security_config`, `s7_connections`, `s7_mappings`
    - Create `src/db/database.ts` with `Database` class that initializes better-sqlite3, applies schema on first run, validates schema version, and handles migrations
    - Implement in-memory cache fallback for read operations when SQLite is inaccessible
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 2. Checkpoint - Ensure project builds and schema initializes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Data access layer (repositories)
  - [x] 3.1 Implement Namespace repository
    - Create `src/db/repositories/namespace-repository.ts` with CRUD operations: `create`, `findAll` (with node counts), `findById`, `update`, `delete` (cascade)
    - Implement uniqueness validation for namespace name
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Implement Folder repository
    - Create `src/db/repositories/folder-repository.ts` with operations: `create`, `findTreeByNamespace` (recursive hierarchy), `delete` (reassign nodes to parent)
    - Implement uniqueness validation for folder name within same parent
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Implement Node repository
    - Create `src/db/repositories/node-repository.ts` with CRUD operations: `create`, `findAll`, `findById`, `update`, `delete`
    - Implement validation for required fields, supported data types, and uniqueness of name within namespace
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 3.4 Implement Security Config repository
    - Create `src/db/repositories/security-repository.ts` with operations: `get`, `updatePolicy`, `updateCertificate`
    - Ensure private key contents are never returned in responses
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 3.5 Implement S7 Connection and Mapping repositories
    - Create `src/db/repositories/s7-repository.ts` with CRUD for connections and mappings
    - Enforce unique constraints: one mapping per node, unique PLC address per connection
    - _Requirements: 7.1, 7.2_

  - [x] 3.6 Write property tests for entity persistence round-trip
    - **Property 1: Entity Persistence Round-Trip**
    - Generate random valid entities (nodes, namespaces, folders, S7 connections, S7 mappings), create via repository, retrieve, and verify field equality excluding timestamps/IDs
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 7.1, 7.2, 10.1**

  - [x] 3.7 Write property test for cascade deletion
    - **Property 2: Cascade Deletion Leaves No Orphans**
    - Generate random namespace trees with folders and nodes, delete namespace, verify zero orphaned folders/nodes remain
    - **Validates: Requirements 2.4**

  - [x] 3.8 Write property test for folder tree structure
    - **Property 3: Folder Tree Structure Correctness**
    - Generate random folder hierarchies within a namespace, retrieve tree, verify every folder appears exactly once with correct parent-child relationships
    - **Validates: Requirements 3.2**

  - [x] 3.9 Write property test for folder deletion reassignment
    - **Property 4: Folder Deletion Reassigns Nodes to Parent**
    - Generate folders with nodes, delete folder, verify all nodes reassigned to parent folder or namespace root with no nodes lost
    - **Validates: Requirements 3.3**

  - [x] 3.10 Write property test for validation rejection
    - **Property 5: Validation Rejects Invalid Input with Descriptive Errors**
    - Generate node definitions with at least one invalid field, submit to repository, verify rejection with error referencing the specific invalid field
    - **Validates: Requirements 1.5**

  - [x] 3.11 Write property test for uniqueness constraints
    - **Property 6: Uniqueness Constraints Prevent Duplicates**
    - Generate duplicate names for namespaces, nodes within namespace, folders within parent, verify rejection with conflict error and original entity unchanged
    - **Validates: Requirements 1.5, 2.5, 3.4**

- [x] 4. Checkpoint - Ensure data layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Authentication middleware
  - [x] 5.1 Implement Auth middleware
    - Create `src/auth/middleware.ts` with Express middleware that validates API key or JWT on mutating endpoints (POST, PUT, DELETE)
    - Allow unauthenticated access to `GET /api/server/status`
    - Return 401 with descriptive error for missing, expired, or invalid credentials
    - Create `src/auth/config.ts` for auth configuration (api-key mode and jwt mode)
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 5.2 Write property test for authentication enforcement
    - **Property 9: Authentication Enforcement on Mutating Endpoints**
    - Generate random mutating HTTP requests (POST, PUT, DELETE) to any endpoint without valid credentials, verify 401 response and system state unchanged
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [x] 6. Config Generator
  - [x] 6.1 Implement Config Generator module
    - Create `src/config-generator/index.ts` implementing the `ConfigGenerator` interface
    - Read all namespaces, folders, and nodes from SQLite, build the `AddressSpaceConfig` JSON structure
    - Write the configuration to a specified file path
    - Include security configuration in the output
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 6.2 Write property test for configuration serialization round-trip
    - **Property 7: Configuration Serialization Round-Trip**
    - Generate random valid address space configurations in SQLite, generate JSON config, parse it back, regenerate, verify byte-equivalent output
    - **Validates: Requirements 5.3, 5.4**

- [x] 7. Process Manager
  - [x] 7.1 Implement Process Manager module
    - Create `src/process-manager/index.ts` implementing the `ProcessManager` interface
    - Use `child_process.spawn()` to launch the open62541 executable
    - Implement `start()`, `stop()`, `reload()`, `getStatus()` methods
    - Monitor process via `exit` and `error` events; detect crashes and update status to "error"
    - Send reload signal via SIGUSR1 (Linux) or named pipe (Windows)
    - Track uptime and connected client count
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Write unit tests for Process Manager
    - Mock `child_process`, verify spawn/kill/signal calls
    - Test crash detection and status transitions
    - Test reload signal dispatch
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

- [x] 8. Express API routes
  - [x] 8.1 Implement Node API routes
    - Create `src/api/routes/nodes.ts` with POST, GET (list), GET (by id), PUT, DELETE endpoints
    - Wire to Node repository with request validation
    - Return proper error responses for validation failures
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 8.2 Implement Namespace API routes
    - Create `src/api/routes/namespaces.ts` with POST, GET (list), PUT, DELETE endpoints
    - Wire to Namespace repository; DELETE cascades folders and nodes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 8.3 Implement Folder API routes
    - Create `src/api/routes/folders.ts` with POST, GET (tree by namespace), DELETE endpoints
    - DELETE reassigns contained nodes to parent folder or namespace root
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 8.4 Implement Server lifecycle API routes
    - Create `src/api/routes/server.ts` with POST start, POST stop, POST reload, GET status endpoints
    - Wire to Process Manager and Config Generator (generate config before start/reload)
    - GET status is unauthenticated per requirement 11.4
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 11.4_

  - [x] 8.5 Implement Security API routes
    - Create `src/api/routes/security.ts` with GET config, PUT policy, POST certificate endpoints
    - Validate certificate format on upload; never expose private key contents in responses
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 8.6 Implement S7 Connector API routes
    - Create `src/api/routes/s7.ts` with CRUD for connections, CRUD for mappings, GET status
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 8.7 Wire Express app with all routes, middleware, and error handling
    - Create `src/api/app.ts` assembling Express app with JSON body parsing, auth middleware, all route modules, and global error handler
    - Create `src/api/server.ts` as the entry point that initializes the database and starts listening
    - Implement consistent error response format across all endpoints
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 8.8 Write property test for security response non-exposure
    - **Property 8: Security Response Never Exposes Private Key Content**
    - Generate random security configurations with various certificate/key paths, call GET security endpoint, verify response never contains private key file contents
    - **Validates: Requirements 6.5**

- [x] 9. Checkpoint - Ensure API tests pass end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. S7 Connector module
  - [x] 10.1 Implement S7 Connector module
    - Create `src/s7-connector/index.ts` implementing the `S7Connector` interface
    - Use `nodes7` library to connect to PLCs, poll mapped variables at configured intervals
    - Implement connection state management: connected, disconnected, error
    - On connection loss: set affected node quality to "bad", attempt reconnection at configured interval
    - On reconnection: resume polling, restore node quality to "good"
    - Communicate value updates to the runtime via IPC mechanism (stdin pipe or shared memory)
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 10.2 Write unit tests for S7 Connector
    - Mock nodes7 library, verify polling behavior, reconnection logic, and quality status updates
    - Test connection state transitions
    - _Requirements: 7.3, 7.4, 7.5_

- [x] 11. OPC UA Runtime (C / open62541)
  - [x] 11.1 Implement open62541 runtime executable
    - Create `runtime/src/main.c` with the open62541 server implementation
    - Parse JSON configuration file path from command-line arguments
    - Load and parse JSON config using a lightweight C JSON library (e.g., cJSON)
    - Build address space from config: register namespaces, create folder objects, create variable nodes
    - Register signal handler for SIGUSR1 to trigger config reload
    - Implement reload: re-read config file, rebuild address space
    - Configure security settings (certificate loading, security mode) based on config
    - _Requirements: 5.1, 5.2, 6.3, 6.4_

  - [x] 11.2 Create CMakeLists.txt build configuration for the runtime
    - Set up CMake project linking against open62541 and cJSON
    - Configure output binary path for the Process Manager to locate
    - _Requirements: 5.1_

- [x] 12. Checkpoint - Ensure runtime builds and starts with a test config
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. React Web UI
  - [x] 13.1 Set up React project with Vite and install UI dependencies
    - Initialize React app in `web/` directory with Vite, TypeScript, React Query, and a component library (e.g., Tailwind CSS or similar)
    - Configure proxy to the Control API for development
    - _Requirements: 8.1, 9.1_

  - [x] 13.2 Implement Dashboard component
    - Create `web/src/components/Dashboard.tsx` displaying server status (running/stopped/error), start/stop/reload buttons, uptime, and connected client count
    - Use React Query with 5-second polling for status updates
    - Wire start/stop/reload buttons to Control API endpoints
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 13.3 Implement AddressSpaceTree and NodeDetailPanel components
    - Create `web/src/components/AddressSpaceTree.tsx` rendering namespaces → folders → nodes as a navigable tree
    - Create `web/src/components/NodeDetailPanel.tsx` showing node details (name, data type, value, metadata) when selected
    - _Requirements: 8.1, 8.2_

  - [x] 13.4 Implement NodeForm and NamespaceManager components
    - Create `web/src/components/NodeForm.tsx` for creating/editing nodes with validation and error display adjacent to fields
    - Create `web/src/components/NamespaceManager.tsx` for namespace CRUD operations
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 13.5 Implement SecuritySettings and S7ConnectionManager components
    - Create `web/src/components/SecuritySettings.tsx` for security mode selection and certificate upload
    - Create `web/src/components/S7ConnectionManager.tsx` for S7 connection and mapping configuration
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.5_

  - [x] 13.6 Wire App layout and routing
    - Create `web/src/App.tsx` with navigation between Dashboard, Address Space, Security, and S7 sections
    - Set up React Query provider and API client utility
    - _Requirements: 8.1, 9.1_

  - [x] 13.7 Write component tests for Web UI
    - Test Dashboard status rendering and button interactions
    - Test AddressSpaceTree rendering with various structures
    - Test NodeForm validation and error display
    - _Requirements: 8.5, 9.1, 9.2_

- [x] 14. Integration wiring and final assembly
  - [x] 14.1 Wire S7 Connector into the server lifecycle
    - Integrate S7 Connector start/stop with Process Manager lifecycle
    - When runtime starts, start active S7 connections; when runtime stops, stop S7 polling
    - Ensure S7 value updates reach the runtime via the IPC mechanism
    - _Requirements: 7.3, 7.4_

  - [x] 14.2 Add static file serving for the Web UI
    - Configure Express to serve the built React app from `web/dist/` at the root path
    - Add build script to compile the React app for production
    - _Requirements: 8.1_

  - [x] 14.3 Write integration tests for runtime lifecycle
    - Test start/stop/reload with actual open62541 binary
    - Test config generation → runtime load → OPC UA client connection
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The C runtime (task 11) can be developed in parallel with the Node.js API since they communicate via a JSON file contract
- The Web UI (task 13) depends on the API being functional but can be developed with mock data initially

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "5.1", "6.1"] },
    { "id": 4, "tasks": ["5.2", "6.2", "7.1"] },
    { "id": 5, "tasks": ["7.2", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6"] },
    { "id": 6, "tasks": ["8.7", "8.8"] },
    { "id": 7, "tasks": ["10.1", "11.1", "11.2", "13.1"] },
    { "id": 8, "tasks": ["10.2", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 9, "tasks": ["13.6", "13.7"] },
    { "id": 10, "tasks": ["14.1", "14.2"] },
    { "id": 11, "tasks": ["14.3"] }
  ]
}
```

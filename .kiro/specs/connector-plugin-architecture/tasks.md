# Implementation Plan: Connector Plugin Architecture

## Overview

Replace the hardcoded connector registration in `server.ts` with a plugin-based auto-discovery system. A `PluginLoader` module scans designated directories at startup, dynamically imports valid connector modules, extracts metadata (including connection parameter schemas), and registers them with the `ConnectorRegistry`. Each existing connector is refactored to implement the new `ConnectorPlugin` interface, and the frontend is updated to fetch protocol metadata dynamically from a new API endpoint.

## Tasks

- [x] 1. Define core types and interfaces
  - [x] 1.1 Add `ConnectorMetadata`, `ParamFieldSchema`, and `ConnectorPlugin` interfaces to `src/connectors/types.ts`
    - Add `ParamFieldSchema` interface with fields: key, label, type, required, defaultValue, placeholder, min, max, options, pattern, patternMessage, description
    - Add `ConnectorMetadata` interface with fields: type, displayName, description, icon, version, paramsSchema
    - Add `ConnectorPlugin` interface extending `Connector` with `getMetadata(): ConnectorMetadata`
    - Export all new types from the existing barrel
    - _Requirements: 2.1, 2.2, 2.3, 3.1_

  - [x] 1.2 Create the params validator module `src/connectors/params-validator.ts`
    - Implement `validateParams(params, schema): ValidationResult` function
    - Handle required field checks, type coercion validation (text, number, boolean, select)
    - Validate min/max bounds for number fields
    - Validate regex pattern for text fields
    - Validate select field values against allowed options
    - Return structured `FieldError[]` with per-field messages
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 1.3 Write property tests for params validator
    - **Property 5: Params validation against paramsSchema**
    - Generate arbitrary `ParamFieldSchema[]` and `params` objects with fast-check
    - Assert: all required fields present with correct types → valid
    - Assert: missing required fields → invalid with per-field errors
    - Assert: number fields outside min/max → invalid
    - Assert: text fields not matching pattern → invalid
    - **Validates: Requirements 9.1, 9.2**

  - [x] 1.4 Write unit tests for params validator
    - Test each field type (text, number, boolean, select) with valid and invalid values
    - Test min/max boundaries for number fields
    - Test pattern matching for text fields
    - Test optional fields are skipped when missing
    - Test unknown fields in params are ignored (backward compatible)
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 2. Implement the plugin loader
  - [x] 2.1 Create `src/connectors/plugin-loader.ts` with `loadPlugins()` and `validateConnectorModule()`
    - Implement `loadPlugins(builtInDir, externalDir?)` that scans directories using `fs.readdir`
    - For each subdirectory, check for `index.js` (compiled output) entry point
    - Use dynamic `import()` to load the module
    - Implement `validateConnectorModule(mod)` with duck-typing checks for `getType()` and `getMetadata()`
    - Instantiate valid connectors and collect their metadata
    - Skip directories without entry points (log reason)
    - Skip modules that fail import (catch errors, log reason)
    - Skip modules without valid Connector exports (log reason)
    - Skip modules missing `getMetadata()` (log reason)
    - Enforce first-registered-wins on duplicate types (log warning)
    - Scan external directory after built-in (built-in precedence on collision)
    - Handle missing/unreadable `CONNECTOR_PLUGINS_DIR` gracefully (log warning, continue)
    - Return `LoadResult { loaded: PluginInfo[], skipped: SkippedPlugin[] }`
    - _Requirements: 1.1, 1.2, 1.3, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3_

  - [x] 2.2 Write property tests for plugin loader discovery
    - **Property 1: Plugin discovery correctly classifies directories**
    - Use fast-check to generate sets of valid/invalid mock modules
    - Assert: valid modules appear in `loaded`, invalid in `skipped`, no crashes
    - **Validates: Requirements 1.1, 1.2, 7.1, 7.2**

  - [x] 2.3 Write property tests for duplicate type handling
    - **Property 3: First-registered type wins on duplicate**
    - Generate sets of modules with overlapping type identifiers
    - Assert: only the first encountered is registered, subsequent are skipped
    - **Validates: Requirements 7.3**

  - [x] 2.4 Write property tests for built-in vs external precedence
    - **Property 4: Built-in plugins take precedence over external**
    - Generate type collisions between built-in and external directories
    - Assert: built-in connector is always the one registered
    - **Validates: Requirements 8.3**

  - [x] 2.5 Write unit tests for plugin loader
    - Test with mock directory containing valid connector module
    - Test with directory missing index.js
    - Test with module that throws on import
    - Test with module exporting non-Connector class
    - Test with module missing `getMetadata()`
    - Test duplicate type registration (second is skipped)
    - Test external directory scanning after built-in
    - Test missing CONNECTOR_PLUGINS_DIR path
    - _Requirements: 1.1, 7.1, 7.2, 7.3, 8.1, 10.1, 10.2_

- [x] 3. Checkpoint - Ensure core modules pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Refactor existing connectors to implement `ConnectorPlugin`
  - [x] 4.1 Update S7 connector (`src/connectors/s7/index.ts`) to implement `ConnectorPlugin`
    - Add `getMetadata(): ConnectorMetadata` method returning type='s7', displayName='Siemens S7', paramsSchema for host/rack/slot
    - Change class declaration to `implements ConnectorPlugin`
    - Ensure all existing behavior is preserved unchanged
    - _Requirements: 2.1, 2.2, 2.3, 6.1_

  - [x] 4.2 Update Modbus TCP connector (`src/connectors/modbus-tcp/index.ts`) to implement `ConnectorPlugin`
    - Add `getMetadata()` returning type='modbus-tcp', displayName='Modbus TCP', paramsSchema for host/port/unitId
    - Change class declaration to `implements ConnectorPlugin`
    - _Requirements: 2.1, 2.2, 2.3, 6.1_

  - [x] 4.3 Update EtherNet/IP connector (`src/connectors/ethernet-ip/index.ts`) to implement `ConnectorPlugin`
    - Add `getMetadata()` returning type='ethernet-ip', displayName='EtherNet/IP', paramsSchema for host/port/slot
    - Change class declaration to `implements ConnectorPlugin`
    - _Requirements: 2.1, 2.2, 2.3, 6.1_

  - [x] 4.4 Update PCCC connector (`src/connectors/pccc/index.ts`) to implement `ConnectorPlugin`
    - Add `getMetadata()` returning type='pccc', displayName='PCCC', paramsSchema for host/port/slot
    - Change class declaration to `implements ConnectorPlugin`
    - _Requirements: 2.1, 2.2, 2.3, 6.1_

- [x] 5. Update ConnectorRegistry for metadata awareness
  - [x] 5.1 Add metadata storage and query methods to `src/connectors/connector-registry.ts`
    - Add private `metadata: Map<ConnectorType, ConnectorMetadata>`
    - Update `register()` to accept optional `ConnectorMetadata` parameter and store it
    - Add `getProtocolsMetadata(): ConnectorMetadata[]` method
    - Add `getProtocolMetadata(type): ConnectorMetadata | undefined` method
    - Add `getParamsSchema(type): ParamFieldSchema[] | undefined` method
    - _Requirements: 3.1, 4.1, 4.2_

  - [x] 5.2 Write unit tests for ConnectorRegistry metadata methods
    - Test `getProtocolsMetadata()` returns all registered metadata
    - Test `getProtocolMetadata(type)` returns specific entry
    - Test `getParamsSchema(type)` returns schema for known type, undefined for unknown
    - _Requirements: 3.1, 4.1_

- [x] 6. Add protocols API endpoint and params validation to routes
  - [x] 6.1 Add `GET /api/connectors/protocols` route to `src/api/routes/connectors.ts`
    - Add the endpoint BEFORE authenticated routes (unauthenticated, consistent with status endpoints)
    - Return `registry.getProtocolsMetadata()` as JSON array
    - Each entry includes type, displayName, description, icon, paramsSchema
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Add params validation to `POST /connections` and `PUT /connections/:id` routes
    - Look up the paramsSchema from the registry by connection type
    - Call `validateParams(params, schema)` before persisting
    - If validation fails, return 400 with structured error `{ error: { code: 'VALIDATION_ERROR', message, details[] } }`
    - If no schema available for the type (unknown protocol), skip validation (backward compatible)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 6.3 Write property tests for protocols endpoint
    - **Property 2: Protocols endpoint returns complete metadata for all registered connectors**
    - Register arbitrary valid connectors, call endpoint, assert one entry per connector with type, displayName, non-empty paramsSchema
    - **Validates: Requirements 4.1, 4.2**

  - [x] 6.4 Write unit tests for protocols route and validation integration
    - Test GET /api/connectors/protocols returns correct shape
    - Test POST /connections with invalid params returns 400 with per-field errors
    - Test POST /connections with valid params succeeds
    - Test PUT /connections/:id with invalid params returns 400
    - Test unknown protocol type skips validation
    - _Requirements: 4.1, 9.1, 9.2_

- [x] 7. Checkpoint - Ensure backend passes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Refactor `server.ts` to use plugin loader
  - [x] 8.1 Replace hardcoded connector imports with dynamic plugin loading in `src/api/server.ts`
    - Remove manual imports of S7Connector, ModbusConnector, EthernetIPConnector, PcccConnector
    - Import and call `loadPlugins(builtInDir, externalDir?)` with correct paths
    - Register loaded plugins via `connectorRegistry.register(plugin.connector, plugin.metadata)`
    - Log loaded count and skipped plugins with reasons
    - Read `CONNECTOR_PLUGINS_DIR` from `process.env` for external plugins
    - _Requirements: 1.1, 1.2, 1.3, 8.1_

  - [x] 8.2 Update `src/connectors/index.ts` barrel to remove individual connector re-exports
    - Remove `export { S7Connector }`, `export { ModbusConnector }`, etc.
    - Keep exports for `ConnectorRegistry`, `IpcBridge`, types, and add export for `loadPlugins`
    - Individual connectors are now discovered dynamically, not imported statically
    - _Requirements: 1.3_

- [x] 9. Update frontend for dynamic protocol discovery
  - [x] 9.1 Add API client function to fetch protocols in `web/src/api.ts`
    - Add `fetchProtocols(): Promise<ConnectorMetadata[]>` function calling `GET /api/connectors/protocols`
    - Define `ConnectorMetadata` and `ParamFieldSchema` TypeScript types in the frontend
    - _Requirements: 4.1, 5.1_

  - [x] 9.2 Refactor `ProtocolSelector` component to fetch protocols dynamically
    - Remove hardcoded `PROTOCOLS` array
    - Fetch from API using React Query (`useQuery`)
    - Render protocol cards from fetched data
    - Show loading state while fetching
    - Handle error state gracefully
    - _Requirements: 5.1_

  - [x] 9.3 Refactor `ConnectionForm` to render fields dynamically from `paramsSchema`
    - Remove hardcoded `S7_FIELDS`, `MODBUS_FIELDS`, `ETHERNET_IP_FIELDS`, `PCCC_FIELDS`
    - Accept `paramsSchema: ParamFieldSchema[]` as prop (fetched from protocol metadata)
    - Render input fields dynamically based on schema (text, number, select types)
    - Keep the raw key-value fallback for protocols without schema (unknown types)
    - Handle boolean fields as checkboxes
    - Show placeholder, min/max, and description from schema
    - Pre-fill default values from schema
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 9.4 Write component tests for dynamic ProtocolSelector
    - Mock API response, verify cards render from fetched data
    - Test loading and error states
    - **Property 6: Dynamic form renders all schema fields**
    - **Validates: Requirements 5.1, 5.2**

  - [x] 9.5 Write component tests for dynamic ConnectionForm
    - Test with various paramsSchema inputs, verify field rendering
    - Test fallback to key-value editor when no schema
    - Test select fields render options correctly
    - _Requirements: 5.2, 5.3_

- [x] 10. Integration testing and final wiring
  - [x] 10.1 Write integration test for full plugin discovery startup
    - Verify the server starts and all 4 built-in connectors are loaded via plugin discovery
    - Verify `GET /api/connectors/protocols` returns 4 protocols with correct metadata
    - _Requirements: 1.1, 6.1, 10.1_

  - [x] 10.2 Verify existing connector tests continue passing
    - Run existing connector CRUD tests (connections and mappings)
    - Ensure no regressions in status/values endpoints
    - _Requirements: 6.1, 6.2, 6.3, 10.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementation uses TypeScript with ES modules
- Existing tests must continue passing without modification (Requirement 10.3)
- The `ConnectorType` union already accepts `string` — no type-level breaking changes (Requirement 6.4)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "4.1", "4.2", "4.3", "4.4"] },
    { "id": 2, "tasks": ["1.3", "1.4", "5.1"] },
    { "id": 3, "tasks": ["2.1", "5.2"] },
    { "id": 4, "tasks": ["2.2", "2.3", "2.4", "2.5", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "6.4", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3"] },
    { "id": 8, "tasks": ["9.4", "9.5", "10.1", "10.2"] }
  ]
}
```

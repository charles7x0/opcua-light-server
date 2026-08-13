# Requirements Document

## Introduction
Refactor the connector system from hardcoded protocol registration to a plugin-based architecture where new protocols can be added by simply creating a folder with the correct interface — no changes to core files required. Currently, adding a new protocol requires editing 3–5 core files (barrel exports, server startup, manual instantiation). This spec defines a plugin system where a connector is discovered and registered automatically at startup.

## Glossary
- **Connector**: A module implementing the `Connector` interface that manages connections to devices of a specific protocol (e.g., S7, Modbus TCP)
- **Plugin**: A self-contained directory under `src/connectors/` (or external plugins dir) that exports a Connector class and metadata
- **ConnectorMetadata**: A descriptor object exposing the protocol's type, display name, and parameter schema for dynamic form rendering
- **ParamsSchema**: A typed definition of the connection parameters a protocol requires (used for UI generation and validation)
- **ConnectorRegistry**: The central registry that manages all connector instances and aggregates status/values across protocols
- **TOFU**: Trust-on-First-Use — certificate management pattern used by the OPC UA runtime

## Requirements

### 1. Auto-Discovery
- The system MUST automatically discover connector plugins from a designated directory (`src/connectors/`) at startup
- Each subdirectory containing an `index.ts` (or compiled `index.js`) that exports a class implementing the `Connector` interface MUST be treated as a valid plugin
- The system MUST NOT require manual imports or registration in `server.ts` or `index.ts` barrel files for new connectors

### 2. Plugin Interface Contract
- Each connector plugin MUST implement the existing `Connector` interface from `src/connectors/types.ts`
- Each connector plugin MUST export a default class (or named `createConnector` factory function)
- Each connector plugin MUST expose a `getMetadata(): ConnectorMetadata` method returning protocol display name, type identifier, description, and connection parameter schema

### 3. Connector Metadata
- The system MUST define a `ConnectorMetadata` interface containing:
  - `type`: protocol identifier string (e.g., `'s7'`, `'modbus-tcp'`)
  - `displayName`: human-readable name (e.g., `'Siemens S7'`)
  - `description`: optional protocol description
  - `paramsSchema`: typed definition of connection parameters (field name, type, label, required, default value, validation)
- The metadata MUST be queryable via a REST API endpoint

### 4. Protocol Discovery API
- The system MUST expose `GET /api/connectors/protocols` returning metadata for all registered connectors
- The response MUST include the parameter schema so the frontend can render forms dynamically
- This endpoint MUST be unauthenticated (consistent with status endpoints)

### 5. Dynamic Frontend
- The `ProtocolSelector` component MUST fetch available protocols from the API instead of hardcoding options
- The `ConnectionForm` MUST render input fields dynamically based on the protocol's `paramsSchema`
- The UI MUST handle unknown protocol types gracefully (display raw JSON params editor as fallback)

### 6. Backward Compatibility
- All existing connectors (S7, Modbus TCP, EtherNet/IP, PCCC) MUST continue working without behavioral changes
- The database schema for connections and mappings MUST NOT change
- Existing API endpoints (`/api/connectors/*`) MUST remain unchanged
- The `ConnectorType` union type already accepts `string` — no type-level breaking changes allowed

### 7. Plugin Loader
- The loader MUST skip directories that don't contain a valid connector export (no crash on invalid plugins)
- The loader MUST log which plugins were loaded and which were skipped (with reason)
- The loader MUST prevent duplicate type registrations (first-registered wins, log a warning)

### 8. Optional: External Plugin Directory
- The system SHOULD support an `CONNECTOR_PLUGINS_DIR` environment variable pointing to an additional directory scanned for plugins
- External plugins MUST implement the same `Connector` interface and metadata contract
- External plugins are loaded AFTER built-in connectors (built-in takes precedence on type collision)

### 9. Validation
- Connection `params` MUST be validated against the plugin's `paramsSchema` when creating/updating connections via the API
- Validation errors MUST return structured error responses with per-field messages
- The existing generic `params: Record<string, unknown>` storage format MUST be preserved

### 10. Testing
- The plugin loader MUST be testable with mock connector directories
- A minimal example plugin MUST be included in documentation or tests demonstrating the interface
- Existing connector tests MUST continue passing without modification

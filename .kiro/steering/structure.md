# Project Structure

```
opcua-light-server/
├── src/                          # Control API source (TypeScript, ES modules)
│   ├── api/                      # Express app and route handlers
│   │   ├── routes/               # Route modules (nodes, namespaces, object-nodes, server, security, s7, files, events)
│   │   ├── app.ts                # Express app assembly
│   │   ├── sse-hub.ts            # SSE connection manager (broadcast, heartbeat, client lifecycle)
│   │   ├── server.ts             # Entry point
│   │   └── https-server.ts       # HTTPS utilities (unused — Control API is HTTP-only)
│   ├── auth/                     # Authentication middleware and config
│   ├── cert-generator/           # Certificate generation and DER/PEM conversion utilities
│   │   ├── index.ts              # Self-signed cert generation, expiry reading
│   │   └── cert-utils.ts         # Pure DER↔PEM conversion functions
│   ├── config-generator/         # Generates JSON config consumed by the C runtime
│   ├── db/                       # SQLite schema, Database class, repositories
│   │   └── repositories/         # Data access layer (one per domain entity)
│   ├── log/                      # Logging utilities (in-memory log service)
│   ├── process-manager/          # Manages the open62541 child process lifecycle
│   ├── connectors/               # Multi-protocol connector plugin architecture
│   │   ├── s7/                   # Siemens S7 connector (nodes7)
│   │   ├── modbus-tcp/           # Modbus TCP connector (modbus-serial)
│   │   ├── ethernet-ip/          # EtherNet/IP connector (ethernet-ip, with tag discovery)
│   │   ├── pccc/                 # PCCC connector for Allen-Bradley legacy PLCs (nodepccc)
│   │   ├── connector-registry.ts # Central registry managing all connector instances
│   │   ├── ipc-bridge.ts         # Bridges value updates to the runtime via stdin
│   │   ├── params-validator.ts   # Validates connection params against plugin paramsSchema
│   │   ├── plugin-loader.ts      # Auto-discovers and loads connector plugins at startup
│   │   └── types.ts              # Connector, ConnectorPlugin, ConnectorMetadata, ParamFieldSchema
│   ├── s7-connector/             # Legacy S7 connector (alias routes still active)
│   ├── types/                    # Domain types, DTOs, and declaration files
│   └── utils/                    # Shared utilities (CSV parsing/serialization)
├── web/                          # React web UI (separate npm package)
│   └── src/
│       ├── components/           # Shared UI primitives
│       │   ├── actions/          # Button, FileButton
│       │   ├── feedback/         # Alert, ConfirmDialog
│       │   ├── inputs/           # Input, Select, Textarea, FormField
│       │   ├── layout/           # Card, CardHeader, Badge
│       │   ├── index.ts          # Barrel export
│       │   └── styles.ts         # Centralized Tailwind class maps
│       ├── hooks/                # Custom React hooks (useNodePaths, etc.)
│       ├── layout/               # App shell, NavBar, StatusBar, LogPanel
│       ├── screens/              # Feature screens
│       │   ├── address-space/    # AddressSpaceSection, Tree, NodeForm, NodeDetailPanel, NamespaceManager
│       │   ├── connectors/       # ConnectorsManager, ConnectionCard, ConnectionForm, ProtocolSelector, MappingTable
│       │   ├── dashboard/        # Dashboard, ConnectedClientsTable
│       │   ├── s7/               # Legacy S7ConnectionManager (may redirect to connectors)
│       │   └── security/         # SecuritySettings, SecurityModeCard, CertificateStatusCard, GenerateCertificateCard, UploadCertificateCard, CertificatePanel, utils/
│       ├── api.ts                # Typed API client (fetch wrapper)
│       └── main.tsx              # Entry point
├── runtime/                      # open62541 C runtime
│   ├── src/main.c                # Runtime entry point
│   ├── CMakeLists.txt            # CMake build config
│   └── build/                    # CMake build output (gitignored)
├── data/                         # Runtime data directory
│   └── certs/                    # Generated certificates (server.der, server.key)
├── tests/                        # All tests (separate from src)
│   ├── unit/                     # Unit tests (repositories, routes, middleware)
│   ├── property/                 # Property-based tests (fast-check)
│   ├── integration/              # Integration tests (runtime lifecycle)
│   └── components/               # React component tests (Testing Library)
├── dist/                         # Compiled JS output (gitignored)
├── vitest.config.ts              # Base vitest config
├── vitest.workspace.ts           # Multi-project test workspace
├── tsconfig.json                 # TypeScript config (backend)
└── tsconfig.web.json             # TypeScript config (web references)
```

## Conventions

- **Tests live in `tests/`**, not alongside source files. Organized by test type.
- **Web UI is a separate package** in `web/` with its own dependencies and build.
- **Web screens** are split into focused single-responsibility components (one concern per file).
- **Shared UI primitives** live in `web/src/components/` organized by category (actions, feedback, inputs, layout).
- **Screen-specific components** live in their screen folder (e.g., `web/src/screens/s7/S7MappingTable.tsx`).
- **Custom hooks** live in `web/src/hooks/` and are reusable across screens.
- **Runtime is a separate C project** in `runtime/` built with CMake.
- **Repositories** follow a one-per-entity pattern in `src/db/repositories/`.
- **Routes** are modular, one file per resource in `src/api/routes/`.
- **Types** are centralized in `src/types/` (domain types, API DTOs, third-party declarations).
- **Certificate utilities** are pure functions in `src/cert-generator/cert-utils.ts` (no side effects, easily testable).
- **Connectors** implement the `ConnectorPlugin` interface from `src/connectors/types.ts` (extends `Connector` with `getMetadata()`). Each protocol lives in its own subdirectory (e.g., `src/connectors/ethernet-ip/`). Plugins are auto-discovered at startup by `plugin-loader.ts` — no manual imports in `server.ts` needed. The EtherNet/IP connector performs automatic tag discovery after connecting.
- **The Control API always uses HTTP** — OPC UA security mode does not affect the REST API transport.

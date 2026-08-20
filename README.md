# OPC UA Light Server

A lightweight OPC UA server system with a Node.js/Express Control API, an [open62541](https://www.open62541.org/) C runtime, and a React web UI. Manage your OPC UA address space, server lifecycle, security, and optional Siemens S7 PLC connections â€” all from a browser.

## Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”       HTTP/REST       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚   React Web UI  â”‚ â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â”‚   Node.js Control API        â”‚
â”‚   (Vite + TW)   â”‚                       â”‚   Express + better-sqlite3   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                       â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                     â”‚ spawn / signal
                                                     â–¼
                                          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  OPC UA Clients â—„â”€â”€ TCP 4840 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º â”‚   open62541 Runtime (C)      â”‚
                                          â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                     â–²
                                                     â”‚ IPC (value updates)
                                          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                          â”‚   Connector Registry         â”‚
                                          â”‚   S7 Â· Modbus TCP Â·          â”‚
  Industrial PLCs â—„â”€â”€ S7/Modbus/CIP â”€â”€â”€â”€â–º â”‚   EtherNet/IP                â”‚
                                          â”‚   polling + reconnection     â”‚
                                          â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Key design decisions:**

- The C runtime runs as a separate OS process for isolation â€” a crash doesn't take down the API.
- Communication between the API and runtime uses a JSON configuration file (written by the API, read by the runtime on start/reload).
- SQLite provides persistence with zero external infrastructure.
- The Control API process installs global error safety nets (`uncaughtException`, `unhandledRejection`) to survive transient errors from connector libraries (e.g., socket errors when a PLC drops abruptly). These errors are logged via the LogService and visible in the system log panel.

## Features

- **Address Space Management** â€” CRUD for namespaces, folders, and nodes via REST API and web UI
- **Server Lifecycle** â€” Start, stop, and hot-reload the OPC UA runtime from the dashboard
- **Security Configuration** â€” Select security mode (None / Sign / SignAndEncrypt) and manage certificates
- **Multi-Protocol PLC Integration** â€” Connect to Siemens S7, Modbus TCP, Rockwell EtherNet/IP, and Allen-Bradley PCCC (SLC 500/MicroLogix/PLC-5) devices via a plugin-based connector architecture with automatic discovery, polling, reconnection, and tag discovery
- **Web Dashboard** â€” Real-time server status with connector health overview, security/certificate summary, address space stats, system info (endpoint URL with copy), and per-client session details
- **Real-Time Updates (SSE)** â€” Single Server-Sent Events connection replaces polling; multiplexed events for status, clients, connectors, and logs
- **Authentication** â€” API key or JWT protection on mutating endpoints

## Prerequisites

- **Node.js** 18+
- **CMake** 3.16+ and a C11 compiler (for the open62541 runtime)
- **Git** (CMake FetchContent downloads open62541 and cJSON automatically)

## Quick Start

```bash
# 1. Install Node.js dependencies
npm install

# 2. Copy the environment file and adjust as needed
cp .env.example .env

# 3. Build the Control API
npm run build

# 4. Build the Web UI
npm run build:web

# 5. Build the OPC UA runtime
cd runtime
mkdir build && cd build
cmake ..
cmake --build .
cd ../..

# 6. Start the server
npm start
```

The Control API starts on port 3100 by default (configurable via `PORT` in `.env`). The web UI is served at the root path (`/`).

## Development

```bash
# Start the API in watch mode
npm run dev

# Start the web UI dev server (with HMR)
cd web && npm run dev

# Run all tests
npm test

# Run specific test suites
npm run test:unit         # Unit tests
npm run test:property     # Property-based tests (fast-check)
npm run test:integration  # Integration tests
```

## Configuration

### Environment Variables

Configuration is managed via a `.env` file in the project root (loaded automatically by `--env-file`). Copy `.env.example` to get started:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Control API listen port |
| `OPCUA_PORT` | `4840` | OPC UA runtime listen port |
| `AUTH_MODE` | `none` | Authentication mode: `none`, `api-key`, or `jwt` |
| `API_KEYS` | â€” | Comma-separated list of valid API keys |
| `JWT_SECRET` | â€” | Secret for JWT token verification |
| `JWT_ISSUER` | â€” | Optional expected JWT issuer claim |
| `DB_PATH` | `runtime/opcua-light.db` | SQLite database file path |
| `RUNTIME_PATH` | `runtime/opcua-runtime` | Path to the compiled open62541 binary |
| `CONFIG_PATH` | `runtime/config.json` | Generated config file path |
| `CONNECTOR_PLUGINS_DIR` | â€” | Optional path to external connector plugins directory |

### Authentication

All mutating endpoints (POST, PUT, DELETE) require authentication. The server status endpoint (`GET /api/server/status`) is unauthenticated for health monitoring.

**API Key mode:**

```bash
export AUTH_MODE=api-key
export API_KEYS=key1,key2,key3
```

Include the key in requests via the `Authorization` header:

```
Authorization: Bearer key1
```

**JWT mode:**

```bash
export AUTH_MODE=jwt
export JWT_SECRET=your-secret
export JWT_ISSUER=your-issuer
```

### OPC UA Security Modes

The security mode controls transport-level security between OPC UA clients and the open62541 runtime. It does **not** affect the REST API, which always runs on plain HTTP.

| Mode | Signing | Encryption | Use Case |
|------|---------|------------|----------|
| **None** | âœ— | âœ— | Development, local testing, trusted network segments |
| **Sign** | âœ“ | âœ— | Physically isolated networks where tamper detection is needed but eavesdropping is acceptable |
| **SignAndEncrypt** | âœ“ | âœ“ | Production / untrusted networks â€” full confidentiality and integrity |

**How it works:**

- Configure via `PUT /api/security/policy` or the web UI Security Settings panel.
- When set to **Sign** or **SignAndEncrypt**, the server requires a certificate and private key. Generate a self-signed certificate through the API (`POST /api/security/generate`) or upload paths to existing files (`POST /api/security/certificate`).
- The C runtime enforces the selected policy at the open62541 level â€” clients that don't meet the security requirement are rejected.
- Certificate health (days until expiry) is monitored and displayed in the web UI status bar.

**Certificate management:**

```bash
# Generate a self-signed certificate with SAN entries
curl -X POST http://localhost:3100/api/security/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dns": ["myserver.local"], "ips": ["192.168.1.10"]}'

# Download the certificate in DER or PEM format
curl http://localhost:3100/api/security/certificate/download?format=pem -o server.pem

# Set security mode to SignAndEncrypt
curl -X PUT http://localhost:3100/api/security/policy \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode": "SignAndEncrypt"}'
```

## API Reference

Interactive API documentation is available via Swagger UI at:

```
http://localhost:3100/api/docs
```

The OpenAPI 3.0 spec is located at [`docs/openapi.json`](docs/openapi.json).

### Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/nodes` | Create a node |
| GET | `/api/nodes` | List all nodes |
| GET | `/api/nodes/:id` | Get a node |
| PUT | `/api/nodes/:id` | Update a node |
| DELETE | `/api/nodes/:id` | Delete a node |
| GET | `/api/nodes/export/csv` | Export all nodes as CSV |
| POST | `/api/nodes/import/csv` | Import nodes from CSV |

### Namespaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/namespaces` | Create a namespace |
| GET | `/api/namespaces` | List namespaces (with node counts) |
| PUT | `/api/namespaces/:id` | Update a namespace |
| DELETE | `/api/namespaces/:id` | Delete namespace (cascades) |

### Folders

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/folders` | Create a folder |
| GET | `/api/namespaces/:id/folders` | Get folder tree |
| DELETE | `/api/folders/:id` | Delete folder (reassigns nodes to parent) |

### Server Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/server/start` | Start the OPC UA runtime |
| POST | `/api/server/stop` | Stop the OPC UA runtime |
| POST | `/api/server/reload` | Reload address space config |
| GET | `/api/server/status` | Get status (unauthenticated) |
| GET | `/api/server/clients` | List connected client sessions (unauthenticated) |

### Real-Time Events (SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events` | Server-Sent Events stream (unauthenticated) |

The `/api/events` endpoint provides a multiplexed SSE stream for real-time updates. It replaces polling for status, client sessions, connector state, connector values, and log entries. Event types:

| Event | Payload | Trigger |
|-------|---------|---------|
| `server:status` | Server status object | Start/stop/reload, periodic (5s while running) |
| `server:clients` | Client sessions array | Session connect/disconnect |
| `connector:status` | Connector statuses array | Connector state transition |
| `connector:values` | Current values array | Poll cycle completes |
| `log:entry` | Log entry object | New log entry appended |

A `:heartbeat` comment is sent every 30 seconds to keep the connection alive. On connect, the server sends initial state events so the client has a complete snapshot immediately.

### Security

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/security` | Get security config |
| PUT | `/api/security/policy` | Set security mode |
| POST | `/api/security/certificate` | Upload certificate paths |

### Connectors (Multi-Protocol)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connectors/protocols` | List available protocol plugins with metadata and parameter schemas (unauthenticated) |
| POST | `/api/connectors/connections` | Create connection (any protocol) |
| GET | `/api/connectors/connections` | List connections (filterable by type) |
| PUT | `/api/connectors/connections/:id` | Update connection |
| DELETE | `/api/connectors/connections/:id` | Delete connection |
| POST | `/api/connectors/mappings` | Create device-to-node mapping |
| GET | `/api/connectors/mappings` | List mappings |
| DELETE | `/api/connectors/mappings/:id` | Delete mapping |
| GET | `/api/connectors/status` | Get all connection statuses |
| GET | `/api/connectors/values` | Get last-read values |
| GET | `/api/connectors/export/csv` | Export mappings as CSV |
| POST | `/api/connectors/import/csv` | Import mappings from CSV |

Supported protocol types: `s7`, `modbus-tcp`, `ethernet-ip`, `pccc`

**Plugin architecture:** Connectors are discovered automatically at startup from `src/connectors/`. Each connector extends the `BaseConnector<TClient, TManaged>` abstract class (which implements `ConnectorPlugin`) and only needs to provide protocol-specific logic: connection initiation, polling, and client cleanup. The base class handles all shared boilerplate â€” connection lifecycle, reconnection scheduling, quality updates, value caching, and timer management. Each plugin exposes a `ParamFieldSchema[]` describing its connection parameters. The frontend fetches this schema via `GET /api/connectors/protocols` to render dynamic forms. New protocols can be added by creating a subdirectory with an `index.ts` exporting a class that extends `BaseConnector` â€” no changes to core files required.

**EtherNet/IP notes:** After connecting to a Rockwell PLC, the connector performs automatic tag discovery so the library learns data types for subsequent read/write operations. Discovery failures are non-fatal â€” polling will still attempt reads. Transient poll errors (read timeouts, CIP protocol errors) mark affected node quality as "bad" without triggering a full reconnection, allowing the next poll cycle to recover automatically.

**PCCC notes:** Connects to Allen-Bradley legacy PLCs (SLC 500, MicroLogix, PLC-5) over EtherNet/IP using file-based addressing. Addresses use standard PCCC format (e.g., `N7:0`, `F8:1`, `B3:0/5`, `T4:0.ACC`). The connector uses pass-through translation â€” address validation happens at mapping time only.

## Project Structure

```
opcua-light-server/
â”œâ”€â”€ .env.example              # Environment variable template
â”œâ”€â”€ package.json              # Dependencies and scripts
â”œâ”€â”€ tsconfig.json             # TypeScript config (backend)
â”œâ”€â”€ tsconfig.web.json         # TypeScript config (web references)
â”œâ”€â”€ vitest.config.ts          # Base Vitest config
â”œâ”€â”€ vitest.workspace.ts       # Multi-project test workspace
â”œâ”€â”€ src/                      # Control API source (TypeScript, ES modules)
â”‚   â”œâ”€â”€ api/
â”‚   â”‚   â”œâ”€â”€ routes/           # Route modules (nodes, namespaces, object-nodes, server,
â”‚   â”‚   â”‚                     #   security, connectors, files, events, pki)
â”‚   â”‚   â”œâ”€â”€ app.ts            # Express app assembly
â”‚   â”‚   â”œâ”€â”€ server.ts         # Entry point
â”‚   â”‚   â””â”€â”€ sse-hub.ts        # SSE connection manager
â”‚   â”œâ”€â”€ auth/                 # Authentication middleware and config
â”‚   â”œâ”€â”€ cert-generator/       # Certificate generation, DER/PEM conversion, validation
â”‚   â”œâ”€â”€ config-generator/     # Generates JSON config consumed by the C runtime
│   ├── connectors/           # Multi-protocol connector plugin architecture
│   │   ├── core/            # Framework infrastructure
│   │   │   ├── base-connector.ts  # Abstract base class (lifecycle, polling, reconnection)
│   │   │   ├── connector-registry.ts  # Central registry managing all connector instances
│   │   │   ├── ipc-bridge.ts      # Bridges value updates to runtime via stdin
│   │   │   ├── params-validator.ts # Validates connection params against plugin schema
│   │   │   ├── plugin-loader.ts   # Auto-discovers connector plugins at startup
│   │   │   └── types.ts           # Connector, ConnectorPlugin, ConnectorMetadata interfaces
│   │   ├── protocols/       # Protocol plugins (auto-discovered at startup)
│   │   │   ├── s7/          # Siemens S7 (nodes7)
│   │   │   ├── modbus-tcp/  # Modbus TCP (modbus-serial)
│   │   │   ├── ethernet-ip/ # EtherNet/IP (ethernet-ip, with tag discovery)
│   │   │   └── pccc/        # Allen-Bradley PCCC (nodepccc)
│   │   └── index.ts         # Barrel export
â”‚   â”œâ”€â”€ db/
â”‚   â”‚   â”œâ”€â”€ repositories/    # Data access layer (one per domain entity)
â”‚   â”‚   â”œâ”€â”€ database.ts      # SQLite wrapper
â”‚   â”‚   â””â”€â”€ schema.sql       # Database schema
â”‚   â”œâ”€â”€ log/                  # In-memory log service
â”‚   â”œâ”€â”€ process-manager/      # Manages the open62541 child process lifecycle
â”‚   â”œâ”€â”€ tofu-manager/         # Trust-on-First-Use certificate management
â”‚   â”œâ”€â”€ types/                # Domain types, DTOs, declaration files
â”‚   â””â”€â”€ utils/                # Shared utilities (CSV parsing, network detection)
â”œâ”€â”€ web/                      # React Web UI (separate npm package)
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ api/              # Typed API client modules (one per domain)
â”‚       â”œâ”€â”€ components/       # Shared UI primitives
â”‚       â”‚   â”œâ”€â”€ actions/      # Button, CopyButton, FileButton, ConfirmDialog
â”‚       â”‚   â”œâ”€â”€ feedback/     # Alert, CardPlaceholder
â”‚       â”‚   â”œâ”€â”€ inputs/       # Input, Select, Textarea, FormField
â”‚       â”‚   â”œâ”€â”€ layout/       # Card, Badge, InfoRow, StatusDot
â”‚       â”‚   â””â”€â”€ styles.ts     # Centralized Tailwind class maps
â”‚       â”œâ”€â”€ hooks/            # Custom React hooks
â”‚       â”‚   â”œâ”€â”€ useServerStatus.ts
â”‚       â”‚   â”œâ”€â”€ useSecurityConfig.ts
â”‚       â”‚   â”œâ”€â”€ useServerControls.ts
â”‚       â”‚   â”œâ”€â”€ useSSE.ts
â”‚       â”‚   â”œâ”€â”€ useLogStream.ts
â”‚       â”‚   â””â”€â”€ useNodePaths.ts
â”‚       â”œâ”€â”€ layout/           # App shell, NavBar, StatusBar, LogPanel
â”‚       â”œâ”€â”€ screens/
â”‚       â”‚   â”œâ”€â”€ address-space/  # Tree, NodeForm, NodeDetailPanel, NamespaceManager
â”‚       â”‚   â”œâ”€â”€ connectors/    # ConnectorsManager, ConnectionCard/Form, MappingTable
â”‚       â”‚   â”œâ”€â”€ dashboard/     # ServerIdentityStrip, ConnectorHealthPanel,
â”‚       â”‚   â”‚                  #   CertificateHealthPanel, AddressSpaceSummaryPanel,
â”‚       â”‚   â”‚                  #   SystemInfoPanel, ConnectedClientsTable
â”‚       â”‚   â””â”€â”€ security/      # SecuritySettings, CertificatePanel, GenerateCertificateCard
â”‚       â”œâ”€â”€ utils/             # formatUptime, formatRelativeDuration, downloadFile
â”‚       â””â”€â”€ main.tsx           # Entry point
â”œâ”€â”€ runtime/                  # open62541 C Runtime
â”‚   â”œâ”€â”€ include/              # Shared C headers (runtime_context.h)
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ address_space/    # Address space builder/clearer
â”‚   â”‚   â”œâ”€â”€ config/           # JSON config parser
â”‚   â”‚   â”œâ”€â”€ ipc/              # Stdin IPC processor (value updates)
â”‚   â”‚   â”œâ”€â”€ security/         # Security config, TOFU verifier
â”‚   â”‚   â”œâ”€â”€ status/           # status.json writer (client sessions)
â”‚   â”‚   â”œâ”€â”€ util/             # File I/O, logging, node ID parser
â”‚   â”‚   â”œâ”€â”€ main.c            # Entry point
â”‚   â”‚   â””â”€â”€ server.c          # Server lifecycle
â”‚   â”œâ”€â”€ CMakeLists.txt        # CMake build config
â”‚   â”œâ”€â”€ build.ps1             # Windows build script
â”‚   â””â”€â”€ build.sh              # Linux/macOS build script
â”œâ”€â”€ tests/                    # All tests (separate from src)
â”‚   â”œâ”€â”€ unit/                 # Unit tests (repositories, routes, middleware, connectors)
â”‚   â”œâ”€â”€ property/             # Property-based tests (fast-check)
â”‚   â”œâ”€â”€ integration/          # Integration tests (runtime lifecycle, SSE)
â”‚   â”œâ”€â”€ components/           # React component tests (Testing Library)
â”‚   â””â”€â”€ stress/               # Performance/load tests
â”œâ”€â”€ docs/                     # Documentation
â”‚   â”œâ”€â”€ openapi.json          # OpenAPI 3.0 spec
â”‚   â””â”€â”€ error-recovery-audit.md
â”œâ”€â”€ data/                     # Runtime data directory
â”‚   â”œâ”€â”€ certs/                # Generated certificates
â”‚   â””â”€â”€ pki/                  # Trust-on-First-Use certificate store
â””â”€â”€ dist/                     # Compiled JS output (gitignored)
```

## Testing

The project uses [Vitest](https://vitest.dev/) with four test projects:

- **Unit** â€” Repository logic, validation, middleware, route handlers
- **Property** â€” Correctness properties verified with [fast-check](https://github.com/dubzzz/fast-check) (persistence round-trips, cascade deletion, uniqueness constraints, auth enforcement, etc.)
- **Integration** â€” Runtime lifecycle with the actual open62541 binary
- **Components** â€” React component tests with Testing Library

```bash
npm test                  # Run all
npm run test:unit         # Unit only
npm run test:property     # Property-based only
npm run test:integration  # Integration only
```

## Supported OPC UA Data Types

Boolean, Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double, String, DateTime, ByteString

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short imperative description
```

**Rules:**
- Subject line under 50 characters
- Use imperative mood ("add feature" not "added feature")
- No period at the end

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature or user-facing change |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build, tooling, config, dependency updates |
| `style` | Formatting, whitespace (no logic change) |
| `perf` | Performance improvement |

**Scopes:**

| Scope | Area |
|-------|------|
| `web` | React web UI |
| `api` | Control API (Express routes, middleware) |
| `s7` | S7 PLC connector |
| `security` | Certificate/auth features |
| `dashboard` | Dashboard screen |
| `runtime` | C open62541 runtime |
| `db` | Database/repositories |
| `nodes` | Node/namespace management |

Omit scope for cross-cutting changes (e.g., `test: add stress test suite`).

**Examples:**

```
feat(s7): show live PLC values in mappings UI
fix(security): handle expired certificate gracefully
refactor(web): split S7 screen into focused components
test: add benchmark wrapper for CPU/memory profiling
chore: initial project setup
```

## License

Private â€” not published to npm.

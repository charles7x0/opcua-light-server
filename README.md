# OPC UA Light Server

A lightweight OPC UA server system with a Node.js/Express Control API, an [open62541](https://www.open62541.org/) C runtime, and a React web UI. Manage your OPC UA address space, server lifecycle, security, and optional Siemens S7 PLC connections — all from a browser.

## Architecture

```
┌─────────────────┐       HTTP/REST       ┌──────────────────────────────┐
│   React Web UI  │ ◄──────────────────── │   Node.js Control API        │
│   (Vite + TW)   │                       │   Express + better-sqlite3   │
└─────────────────┘                       └──────────┬───────────────────┘
                                                     │ spawn / signal
                                                     ▼
                                          ┌──────────────────────────────┐
  OPC UA Clients ◄── TCP 4840 ──────────► │   open62541 Runtime (C)      │
                                          └──────────────────────────────┘
                                                     ▲
                                                     │ IPC (value updates)
                                          ┌──────────┴───────────────────┐
                                          │   Connector Registry         │
                                          │   S7 · Modbus TCP ·          │
  Industrial PLCs ◄── S7/Modbus/CIP ────► │   EtherNet/IP                │
                                          │   polling + reconnection     │
                                          └──────────────────────────────┘
```

**Key design decisions:**

- The C runtime runs as a separate OS process for isolation — a crash doesn't take down the API.
- Communication between the API and runtime uses a JSON configuration file (written by the API, read by the runtime on start/reload).
- SQLite provides persistence with zero external infrastructure.
- The Control API process installs global error safety nets (`uncaughtException`, `unhandledRejection`) to survive transient errors from connector libraries (e.g., socket errors when a PLC drops abruptly). These errors are logged via the LogService and visible in the system log panel.

## Features

- **Address Space Management** — CRUD for namespaces, folders, and nodes via REST API and web UI
- **Server Lifecycle** — Start, stop, and hot-reload the OPC UA runtime from the dashboard
- **Security Configuration** — Select security mode (None / Sign / SignAndEncrypt) and manage certificates
- **Multi-Protocol PLC Integration** — Connect to Siemens S7, Modbus TCP, Rockwell EtherNet/IP, and Allen-Bradley PCCC (SLC 500/MicroLogix/PLC-5) devices via a unified connector architecture with automatic polling, reconnection, and tag discovery
- **Web Dashboard** — Real-time server status, uptime, connected client count, and per-client session details (app name, security policy, address, connection duration, state)
- **Real-Time Updates (SSE)** — Single Server-Sent Events connection replaces polling; multiplexed events for status, clients, connectors, and logs
- **Authentication** — API key or JWT protection on mutating endpoints

## Prerequisites

- **Node.js** 18+
- **CMake** 3.16+ and a C11 compiler (for the open62541 runtime)
- **Git** (CMake FetchContent downloads open62541 and cJSON automatically)

## Quick Start

```bash
# 1. Install Node.js dependencies
npm install

# 2. Build the Control API
npm run build

# 3. Build the Web UI
npm run build:web

# 4. Build the OPC UA runtime
cd runtime
mkdir build && cd build
cmake ..
cmake --build .
cd ../..

# 5. Configure authentication (see Configuration section)
export AUTH_MODE=api-key
export API_KEYS=my-secret-key

# 6. Start the server
npm start
```

The Control API starts on port 3100 by default. The web UI is served at the root path (`/`).

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

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Control API listen port |
| `OPCUA_PORT` | `4840` | OPC UA runtime listen port |
| `AUTH_MODE` | `none` | Authentication mode: `none`, `api-key`, or `jwt` |
| `API_KEYS` | — | Comma-separated list of valid API keys |
| `JWT_SECRET` | — | Secret for JWT token verification |
| `JWT_ISSUER` | — | Optional expected JWT issuer claim |
| `DB_PATH` | `./data/opcua-light.db` | SQLite database file path |
| `RUNTIME_PATH` | `./runtime/opcua-runtime` | Path to the compiled open62541 binary |

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
| **None** | ✗ | ✗ | Development, local testing, trusted network segments |
| **Sign** | ✓ | ✗ | Physically isolated networks where tamper detection is needed but eavesdropping is acceptable |
| **SignAndEncrypt** | ✓ | ✓ | Production / untrusted networks — full confidentiality and integrity |

**How it works:**

- Configure via `PUT /api/security/policy` or the web UI Security Settings panel.
- When set to **Sign** or **SignAndEncrypt**, the server requires a certificate and private key. Generate a self-signed certificate through the API (`POST /api/security/generate`) or upload paths to existing files (`POST /api/security/certificate`).
- The C runtime enforces the selected policy at the open62541 level — clients that don't meet the security requirement are rejected.
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

### S7 Connector

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/s7/connections` | Create S7 connection |
| GET | `/api/s7/connections` | List connections |
| DELETE | `/api/s7/connections/:id` | Delete connection |
| POST | `/api/s7/mappings` | Create PLC-to-node mapping |
| GET | `/api/s7/mappings` | List mappings |
| DELETE | `/api/s7/mappings/:id` | Delete mapping |
| GET | `/api/s7/status` | Get connection statuses |
| GET | `/api/s7/values` | Get last-read values for all mapped variables |

### Connectors (Multi-Protocol)

| Method | Endpoint | Description |
|--------|----------|-------------|
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

**EtherNet/IP notes:** After connecting to a Rockwell PLC, the connector performs automatic tag discovery so the library learns data types for subsequent read/write operations. Discovery failures are non-fatal — polling will still attempt reads. Transient poll errors (read timeouts, CIP protocol errors) mark affected node quality as "bad" without triggering a full reconnection, allowing the next poll cycle to recover automatically.

**PCCC notes:** Connects to Allen-Bradley legacy PLCs (SLC 500, MicroLogix, PLC-5) over EtherNet/IP using file-based addressing. Addresses use standard PCCC format (e.g., `N7:0`, `F8:1`, `B3:0/5`, `T4:0.ACC`). The connector uses pass-through translation — address validation happens at mapping time only.

## Project Structure

```
opcua-light-server/
├── src/
│   ├── api/              # Express routes and app setup
│   │   ├── routes/       # Route handlers (nodes, namespaces, folders, server, security, s7, events)
│   │   ├── app.ts        # Express app assembly
│   │   ├── sse-hub.ts    # SSE connection manager (broadcast, heartbeat, client lifecycle)
│   │   └── server.ts     # Entry point
│   ├── auth/             # Authentication middleware and config
│   ├── config-generator/ # Generates JSON config for the runtime
│   ├── db/               # SQLite schema, database class, repositories
│   ├── process-manager/  # Manages the open62541 child process
│   ├── connectors/      # Multi-protocol connector registry (S7, Modbus TCP, EtherNet/IP, PCCC)
│   ├── s7-connector/    # Legacy S7 PLC connector (alias routes still active)
│   ├── types/           # TypeScript domain types and DTOs
│   ├── utils/            # Shared utilities (CSV parsing, etc.)
│   └── shared/           # Shared utilities
├── web/                  # React web UI (Vite + Tailwind CSS)
│   └── src/
│       ├── components/   # Shared UI primitives (actions/, feedback/, inputs/, layout/)
│       ├── hooks/        # Custom React hooks (useNodePaths, etc.)
│       ├── layout/       # App shell, NavBar, StatusBar, LogPanel
│       ├── screens/      # Feature screens (address-space/, dashboard/, s7/, security/)
│       ├── api.ts        # Typed API client
│       └── main.tsx      # Entry point
├── runtime/              # open62541 C runtime
│   ├── src/main.c        # Runtime entry point
│   └── CMakeLists.txt    # CMake build config
├── tests/
│   ├── unit/             # Unit tests
│   ├── property/         # Property-based tests (fast-check)
│   ├── integration/      # Integration tests
│   └── components/       # React component tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── vitest.workspace.ts
```

## Testing

The project uses [Vitest](https://vitest.dev/) with four test projects:

- **Unit** — Repository logic, validation, middleware, route handlers
- **Property** — Correctness properties verified with [fast-check](https://github.com/dubzzz/fast-check) (persistence round-trips, cascade deletion, uniqueness constraints, auth enforcement, etc.)
- **Integration** — Runtime lifecycle with the actual open62541 binary
- **Components** — React component tests with Testing Library

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

Private — not published to npm.

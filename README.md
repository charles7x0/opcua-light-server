<div align="center">

[![License][badge-license]][link-license]

<br/>

<img src="docs/images/OPCUA_Light_Server-_Logo-removebg-preview.png" width="350" title=" Lightweight OPC UA server Logo">

<br/>

[![Node.js][badge-nodejs]][link-nodejs]
[![Express][badge-express]][link-express]
[![TypeScript][badge-typescript]][link-typescript]
[![React][badge-react]][link-react]
[![open62541][badge-open62541]][link-open62541]

### Lightweight OPC UA server with multi-protocol PLC integration

<br/>

[![GitHub Issues][badge-issues]][link-issues]
[![GitHub Stars][badge-stars]][link-stars]

</div>

## Quick Start

Check out the [Getting Started](#getting-started) section for full instructions.

1. `npm install && npm install --prefix web`
2. `npm run build && npm run build:web`
3. Build the C runtime (see [Getting Started](#getting-started))
4. `npm start`

<br/>

> [!NOTE]
> OPC UA Light Server is a three-component system: a Node.js/Express Control API, an open62541 C runtime, and a React web UI. It manages OPC UA address spaces, server lifecycle, security, and multi-protocol PLC connections — all from a browser or REST API.

## Features

- **Address Space Management** — CRUD for namespaces, folders, and nodes via REST API and web UI
- **Server Lifecycle** — Start, stop, and hot-reload the OPC UA runtime from the dashboard
- **Security Configuration** — Security modes (None / Sign / SignAndEncrypt) with certificate management and TOFU client trust
- **Multi-Protocol PLC Integration** — Siemens S7, Modbus TCP, Rockwell EtherNet/IP, and Allen-Bradley PCCC via a plugin-based connector architecture
- **Web Dashboard** — Real-time server status, connector health, certificate summary, address space stats, and per-client session details
- **Real-Time Updates (SSE)** — Single Server-Sent Events connection replaces polling for all live data
- **Authentication** — API key or JWT protection on mutating endpoints
- **Docker Support** — Multi-stage Alpine-based image (~200 MB) for amd64 and arm64

## Links

- [Getting Started](#getting-started)
- [Docker](#docker)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

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
  Industrial PLCs ◄── S7/Modbus/CIP ────► │   EtherNet/IP · PCCC        │
                                          │   polling + reconnection     │
                                          └──────────────────────────────┘
```

**Key design decisions:**

- The C runtime runs as a separate OS process for crash isolation
- Communication uses a JSON config file (API writes, runtime reads on start/reload) and stdin IPC for live value updates
- SQLite provides persistence with zero external infrastructure
- Global error safety nets (`uncaughtException`, `unhandledRejection`) prevent connector library crashes from taking down the API

## Getting Started

### Prerequisites

- **Node.js** 18+
- **CMake** 3.16+ and a C11 compiler (for the open62541 runtime)
- **Git** (CMake FetchContent downloads open62541 and cJSON automatically)

### Install

```bash
# Install Node.js dependencies (API + web UI)
npm install
npm install --prefix web

# Copy the environment file
cp .env.example .env
```

### Build

```bash
# Build the Control API (TypeScript → dist/)
npm run build

# Build the Web UI
npm run build:web

# Build the OPC UA runtime
cd runtime
mkdir build && cd build
cmake ..
cmake --build .
cd ../..
```

### Run

```bash
npm start
```

The server starts on port 3100. Open `http://localhost:3100` for the web UI.

### Development

```bash
# Start the API in watch mode (hot-reload on TypeScript changes)
npm run dev

# Start the web UI dev server (HMR via Vite)
cd web && npm run dev

# Run all tests
npm test

# Run specific test suites
npm run test:unit         # Unit tests
npm run test:property     # Property-based tests (fast-check)
npm run test:integration  # Integration tests

# Reset runtime data (database, certificates, PKI store)
npm run reset
```

## Docker

Build and run as a container (includes API, web UI, and OPC UA runtime):

```bash
# Build the image
docker build -t opcua-light-server .

# Run with default settings
docker run -d -p 3100:3100 -p 4840:4840 -v opcua-data:/app/data opcua-light-server

# Run with custom environment
docker run -d \
  -p 3100:3100 \
  -p 4840:4840 \
  -e AUTH_MODE=api-key \
  -e API_KEYS=mykey \
  -v opcua-data:/app/data \
  opcua-light-server
```

The image uses a multi-stage build (Alpine-based, ~200 MB final size). Port 3100 serves both the REST API and the web UI. Port 4840 is the OPC UA runtime (TCP).

For multi-platform builds (amd64 + arm64):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/opcua-light-server:latest --push .
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
| `DB_PATH` | `runtime/opcua-light.db` | SQLite database file path |
| `RUNTIME_PATH` | `runtime/opcua-runtime` | Path to the compiled open62541 binary |
| `CONFIG_PATH` | `runtime/config.json` | Generated config file path |
| `CONNECTOR_PLUGINS_DIR` | — | Optional path to external connector plugins directory |

### Authentication

All mutating endpoints (POST, PUT, DELETE) require authentication. `GET /api/server/status` is unauthenticated for health monitoring.

**API Key mode:**

```bash
AUTH_MODE=api-key
API_KEYS=key1,key2,key3
```

Header: `Authorization: Bearer key1`

**JWT mode:**

```bash
AUTH_MODE=jwt
JWT_SECRET=your-secret
JWT_ISSUER=your-issuer
```

### OPC UA Security Modes

| Mode | Signing | Encryption | Use Case |
|------|---------|------------|----------|
| **None** | ✗ | ✗ | Development, trusted networks |
| **Sign** | ✓ | ✗ | Isolated networks, tamper detection needed |
| **SignAndEncrypt** | ✓ | ✓ | Production, untrusted networks |

Sign and SignAndEncrypt require a server certificate. Generate one via the API or web UI before enabling these modes. The runtime restarts automatically when the security mode changes.

### Client Certificate Trust (TOFU)

When security is enabled, clients must present an X.509 certificate. The server uses Trust On First Use:

1. **First connection** — unknown certificate auto-stored in `data/pki/trusted/`
2. **Subsequent connections** — recognized by thumbprint (SHA-1)
3. **Revocation** — move to `data/pki/rejected/` via API or web UI
4. **Re-trust** — move back to trusted store

Trust store changes take effect immediately via IPC — no restart required.

## API Reference

Interactive documentation: `http://localhost:3100/api/docs` (Swagger UI)

OpenAPI 3.0 spec: [`docs/openapi.json`](docs/openapi.json)

### Server Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/server/status` | Server status (unauthenticated) |
| GET | `/api/server/clients` | Connected client sessions (unauthenticated) |
| POST | `/api/server/start` | Start the OPC UA runtime |
| POST | `/api/server/stop` | Stop the OPC UA runtime |
| POST | `/api/server/reload` | Reload address space config |

### Address Space

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/nodes` | List/create nodes |
| GET/PUT/DELETE | `/api/nodes/:id` | Get/update/delete node |
| GET/POST | `/api/namespaces` | List/create namespaces |
| PUT/DELETE | `/api/namespaces/:id` | Update/delete namespace |
| POST | `/api/object-nodes` | Create object node (folder) |
| DELETE | `/api/object-nodes/:id` | Delete object node |
| GET | `/api/nodes/export/csv` | Export nodes as CSV |
| POST | `/api/nodes/import/csv` | Import nodes from CSV |

### Security

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/security` | Get security config |
| PUT | `/api/security/policy` | Set security mode |
| POST | `/api/security/certificate` | Upload certificate paths |
| POST | `/api/security/generate` | Generate self-signed certificate |
| GET | `/api/security/certificate/download` | Download certificate (DER/PEM) |

### Connectors (Multi-Protocol)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connectors/protocols` | List protocol plugins (unauthenticated) |
| GET/POST | `/api/connectors/connections` | List/create connections |
| PUT/DELETE | `/api/connectors/connections/:id` | Update/delete connection |
| GET/POST | `/api/connectors/mappings` | List/create mappings |
| PUT/DELETE | `/api/connectors/mappings/:id` | Update/delete mapping |
| GET | `/api/connectors/status` | Connection statuses |
| GET | `/api/connectors/values` | Live values |
| GET | `/api/connectors/mappings/export/csv` | Export mappings as CSV |
| POST | `/api/connectors/mappings/import/csv` | Import mappings from CSV |

Supported protocols: `s7`, `modbus-tcp`, `ethernet-ip`, `pccc`

### PKI (Client Certificates)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pki/certificates` | List all client certificates |
| POST | `/api/pki/certificates/:thumbprint/reject` | Reject a certificate |
| POST | `/api/pki/certificates/:thumbprint/trust` | Re-trust a certificate |
| DELETE | `/api/pki/certificates/:thumbprint` | Delete permanently |

### Real-Time Events (SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events` | Multiplexed SSE stream (unauthenticated) |

Events: `server:status`, `server:clients`, `connector:status`, `connector:values`, `log:entry`

## Project Structure

```
opcua-light-server/
├── src/                      # Control API (TypeScript, ES modules)
│   ├── api/                  # Express app, routes, SSE hub
│   ├── auth/                 # Authentication middleware
│   ├── cert-generator/       # Certificate generation and DER/PEM conversion
│   ├── config-generator/     # Runtime JSON config builder
│   ├── connectors/           # Multi-protocol connector plugin system
│   │   ├── core/            # Framework (BaseConnector, registry, loader, validator)
│   │   └── protocols/       # Plugins (s7, modbus-tcp, ethernet-ip, pccc)
│   ├── db/                   # SQLite database and repositories
│   ├── log/                  # In-memory log service with SSE broadcast
│   ├── process-manager/      # C runtime child process lifecycle
│   ├── tofu-manager/         # TOFU certificate trust management
│   ├── types/                # Domain types and DTOs
│   └── utils/                # Shared utilities
├── web/                      # React Web UI (Vite + Tailwind)
│   └── src/
│       ├── api/              # Typed API client
│       ├── components/       # Shared UI primitives
│       ├── hooks/            # React Query hooks, SSE, log stream
│       ├── layout/           # App shell, NavBar, StatusBar, LogPanel
│       └── screens/          # Feature screens (dashboard, connectors, security, address-space)
├── runtime/                  # open62541 C Runtime
│   └── src/                  # Server, config parser, IPC, security, status writer
├── tests/                    # Unit, property, integration, component tests
├── docs/                     # OpenAPI spec, error recovery audit
└── data/                     # Runtime data (database, certificates, PKI)
```

## Tech Stack

- **Node.js 18+** + **Express 4** — Control API
- **TypeScript 5** — strict mode, ES modules
- **better-sqlite3** — embedded database
- **open62541 v1.3.9** — OPC UA C runtime (via CMake FetchContent)
- **React 18** + **TanStack React Query** — web UI
- **Tailwind CSS** — styling (centralized class maps)
- **Vite** — frontend build
- **Vitest** + **fast-check** — testing (unit, property, integration, component)
- **nodes7** / **modbus-serial** / **ethernet-ip** / **nodepccc** — PLC protocol libraries
- **node-forge** — certificate generation
- **Docker** — multi-stage Alpine build

## Testing

```bash
npm test                  # Run all (unit + property + integration + component)
npm run test:unit         # Unit tests only
npm run test:property     # Property-based tests (fast-check)
npm run test:integration  # Integration tests (requires runtime binary)
```

## Supported OPC UA Data Types

Boolean, Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double, String, DateTime, ByteString

## Contributing

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short imperative description
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`

Scopes: `web`, `api`, `security`, `dashboard`, `runtime`, `db`, `nodes`

## License

MIT — see [LICENSE](LICENSE).

<!-- Badge images -->
[badge-license]: https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge&labelColor=ececec
[badge-nodejs]: https://img.shields.io/badge/Node.js-18+-339933.svg?style=for-the-badge&logo=node.js&logoColor=339933&labelColor=ececec
[badge-express]: https://img.shields.io/badge/Express-4-000000.svg?style=for-the-badge&logo=express&logoColor=000000&labelColor=ececec
[badge-typescript]: https://img.shields.io/badge/TypeScript-5-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=3178C6&labelColor=ececec
[badge-react]: https://img.shields.io/badge/React-18-61DAFB.svg?style=for-the-badge&logo=react&logoColor=61DAFB&labelColor=ececec
[badge-open62541]: https://img.shields.io/badge/open62541-v1.3.9-orange.svg?style=for-the-badge&labelColor=ececec
[badge-issues]: https://img.shields.io/github/issues/charles7x0/opcua-light-server?style=for-the-badge&labelColor=ececec
[badge-stars]: https://img.shields.io/github/stars/charles7x0/opcua-light-server?style=for-the-badge&labelColor=ececec

<!-- Badge links -->
[link-license]: https://opensource.org/licenses/MIT
[link-nodejs]: https://nodejs.org/
[link-express]: https://expressjs.com/
[link-typescript]: https://www.typescriptlang.org/
[link-react]: https://react.dev/
[link-open62541]: https://www.open62541.org/
[link-issues]: https://github.com/charles7x0/opcua-light-server/issues
[link-stars]: https://github.com/charles7x0/opcua-light-server/stargazers

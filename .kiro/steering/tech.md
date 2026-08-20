# Tech Stack

## Backend (Control API)

- **Runtime**: Node.js 18+ with ES modules (`"type": "module"`)
- **Language**: TypeScript 5 (strict mode, ES2022 target, bundler module resolution)
- **Framework**: Express 4
- **Database**: better-sqlite3 (SQLite)
- **Auth**: jsonwebtoken (JWT) + API key support
- **Crypto**: node-forge (certificate generation, DER/PEM parsing)
- **S7 PLC**: nodes7 library
- **Modbus TCP**: modbus-serial library
- **EtherNet/IP**: ethernet-ip library (with automatic tag discovery on connect)
- **PCCC**: nodepccc library (Allen-Bradley SLC 500, MicroLogix, PLC-5)
- **Build**: `tsc` (plain TypeScript compiler)
- **Dev**: tsx (watch mode)

## Frontend (Web UI)

- **Framework**: React 18 with TanStack React Query
- **Styling**: Tailwind CSS + PostCSS (centralized style maps in `components/styles.ts`)
- **Build**: Vite
- **Component architecture**: Shared UI primitives (actions/, feedback/, inputs/, layout/) + screen-specific components
- **Separate package** in `web/` with its own `node_modules`

## OPC UA Runtime

- **Language**: C11
- **Library**: open62541 (fetched via CMake FetchContent)
- **JSON parsing**: cJSON (fetched via CMake FetchContent)
- **Build**: CMake 3.16+

## Testing

- **Framework**: Vitest 2 with workspace configuration (4 test projects)
- **Property-based testing**: fast-check 3
- **Component testing**: Testing Library (React) + jsdom
- **Test projects**: unit, property, integration, components

## Common Commands

```bash
# Install dependencies
npm install

# Build the Control API (TypeScript → dist/)
npm run build

# Build the Web UI
npm run build:web

# Start API in watch mode (development)
npm run dev

# Start production server
npm start

# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:property
npm run test:integration

# Build the C runtime
cd runtime && mkdir build && cd build && cmake .. && cmake --build .
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Control API listen port |
| `OPCUA_PORT` | `4840` | OPC UA runtime listen port |
| `AUTH_MODE` | `none` | `none`, `api-key`, or `jwt` |
| `API_KEYS` | — | Comma-separated valid API keys |
| `JWT_SECRET` | — | JWT verification secret |
| `DB_PATH` | `./data/opcua-light.db` | SQLite database path |
| `RUNTIME_PATH` | `./runtime/opcua-runtime` | Path to compiled open62541 binary |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/server/status` | Server status (unauthenticated) |
| GET | `/api/server/clients` | Connected client sessions (unauthenticated) |
| GET | `/api/events` | SSE stream for real-time updates (unauthenticated) |
| POST | `/api/server/start` | Start OPC UA runtime |
| POST | `/api/server/stop` | Stop OPC UA runtime |
| POST | `/api/server/reload` | Hot-reload address space |
| GET | `/api/security` | Get security config |
| PUT | `/api/security/policy` | Update security mode |
| POST | `/api/security/certificate` | Upload certificate paths |
| POST | `/api/security/generate` | Generate self-signed certificate |
| GET | `/api/security/certificate/download` | Download certificate (DER/PEM) |
| POST | `/api/files/browse` | Server-side file browser |
| GET | `/api/nodes` | List nodes |
| POST | `/api/nodes` | Create node |
| GET | `/api/nodes/export/csv` | Export nodes as CSV |
| POST | `/api/nodes/import/csv` | Import nodes from CSV |
| GET | `/api/namespaces` | List namespaces |
| GET | `/api/logs` | System log entries |
| GET | `/api/connectors/protocols` | Available protocol plugins with metadata (unauthenticated) |
| GET/POST/PUT/DELETE | `/api/connectors/*` | Multi-protocol connections, mappings, status, values |

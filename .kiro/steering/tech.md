# Tech Stack

## Backend (Control API)

- **Runtime**: Node.js 18+ with ES modules (`"type": "module"`)
- **Language**: TypeScript 5 (strict mode, ES2022 target, bundler module resolution)
- **Framework**: Express 4
- **Database**: better-sqlite3 (SQLite)
- **Auth**: jsonwebtoken (JWT) + API key support
- **S7 PLC**: nodes7 library
- **Build**: `tsc` (plain TypeScript compiler)
- **Dev**: tsx (watch mode)

## Frontend (Web UI)

- **Framework**: React 18 with TanStack React Query
- **Styling**: Tailwind CSS + PostCSS
- **Build**: Vite
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
| `AUTH_MODE` | `none` | `none`, `api-key`, or `jwt` |
| `API_KEYS` | — | Comma-separated valid API keys |
| `JWT_SECRET` | — | JWT verification secret |
| `DB_PATH` | `./data/opcua-light.db` | SQLite database path |
| `RUNTIME_PATH` | `./runtime/opcua-runtime` | Path to compiled open62541 binary |

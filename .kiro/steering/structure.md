# Project Structure

```
opcua-light-server/
├── src/                          # Control API source (TypeScript, ES modules)
│   ├── api/                      # Express app and route handlers
│   │   ├── routes/               # Route modules (nodes, namespaces, folders, server, security, s7)
│   │   ├── app.ts                # Express app assembly
│   │   └── server.ts             # Entry point
│   ├── auth/                     # Authentication middleware and config
│   ├── config-generator/         # Generates JSON config consumed by the C runtime
│   ├── db/                       # SQLite schema, Database class, repositories
│   │   └── repositories/         # Data access layer (one per domain entity)
│   ├── log/                      # Logging utilities
│   ├── process-manager/          # Manages the open62541 child process lifecycle
│   ├── s7-connector/             # S7 PLC polling and value update logic
│   └── types/                    # Domain types, DTOs, and declaration files
├── web/                          # React web UI (separate npm package)
│   └── src/
│       ├── components/           # React components (Dashboard, NodeForm, etc.)
│       ├── hooks/                # Custom React hooks
│       ├── api.ts                # API client
│       └── App.tsx               # Root component
├── runtime/                      # open62541 C runtime
│   ├── src/main.c                # Runtime entry point
│   ├── CMakeLists.txt            # CMake build config
│   └── build/                    # CMake build output (gitignored)
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
- **Runtime is a separate C project** in `runtime/` built with CMake.
- **Repositories** follow a one-per-entity pattern in `src/db/repositories/`.
- **Routes** are modular, one file per resource in `src/api/routes/`.
- **Types** are centralized in `src/types/` (domain types, API DTOs, third-party declarations).

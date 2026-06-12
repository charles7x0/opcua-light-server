# Error Recovery Audit

## Summary

This document assesses the current state of runtime error recovery strategies in the OPC UA Light Server project. The system has three main failure domains: the C runtime process, the SQLite database, and S7 PLC connections. Each requires specific recovery mechanisms to maintain availability.

---

## What Already Exists ✅

| Strategy | Implementation |
|----------|---------------|
| Crash detection | Process manager detects unexpected exits/errors and fires `onCrash` callbacks |
| S7 reconnection | Automatic reconnect on failure with configurable interval |
| S7 stale value marking | Sets node quality to `"bad"` on disconnect, `"good"` on reconnect |
| WAL mode | Enabled in SQLite (implicit crash recovery) |
| DB cache fallback | `readWithCache()` returns last-known-good data when DB is inaccessible |
| Typed DB error | `DatabaseUnavailableError` class with `isAccessible()` health check |
| Structured API errors | Consistent `{ error: { code, message, details? } }` format with typed `ErrorCode` union |
| Route error mapping | `handleRepositoryError()` maps domain errors to proper HTTP codes (400/404/409/500) |
| Status endpoint | `GET /api/server/status` — unauthenticated, reports state/uptime/pid/clients/lastError |
| Structured logging | Centralized `logService` with levels, sources, ring buffer, API endpoint, web panel |
| UI connection indicator | StatusBar shows green/red dot for API reachability and runtime state |
| UI error states | Dashboard shows error messages, mutations display inline failures |
| TanStack Query retries | Configured with `retry: 1` and auto-refetch on status |

---

## What's Missing ❌

| Strategy | Gap |
|----------|-----|
| Automatic restart | `onCrash` hook exists but nothing wires up a restart. No backoff, no restart counter, no max attempts. |
| SQLITE_BUSY retry | No busy timeout configured, no retry loop on transient lock contention |
| DB integrity check | No `PRAGMA integrity_check` on startup |
| Exponential backoff (S7) | Reconnect uses a fixed interval — no progressive delay or jitter |
| Circuit breaker | No circuit breaker on any external dependency (S7, runtime) |
| Input validation middleware | No Zod/Joi/express-validator — validation lives ad-hoc in route handlers |
| React Error Boundary | Rendering crash in any component takes down the whole UI |
| Global query error handler | No `onError` in QueryClient — no toast/banner for transient network failures |
| Combined health endpoint | No single probe that checks DB + runtime + S7 together |
| File-based logging | Logs are in-memory only — lost on restart, no disk persistence |
| Request rate limiting | No throttle protection on mutating endpoints |

---

## Detailed Findings by Component

### 1. Process Manager (`src/process-manager/index.ts`)

**Exists:**
- Crash detection via `exit` and `error` event listeners on the child process
- Crash handler callback system (`onCrash()`) for external notification
- State tracking (`running`, `stopped`, `error`) with `lastError` message
- Graceful shutdown with 10-second timeout before SIGKILL
- Windows-specific termination via `taskkill`

**Missing:**
- No automatic restart logic after crash
- No backoff/retry strategy
- No restart counter or crash frequency tracking
- No maximum restart attempts limit

### 2. Database (`src/db/database.ts`)

**Exists:**
- `DatabaseUnavailableError` typed error class
- `isAccessible()` health check method (`SELECT 1`)
- In-memory cache fallback via `readWithCache()`
- `write()` method that throws `DatabaseUnavailableError` when DB is unavailable
- WAL journal mode enabled
- Schema versioning with migrations
- `accessible` state tracking

**Missing:**
- No `SQLITE_BUSY` retry logic (no busy timeout or retry loop)
- No `PRAGMA integrity_check` on startup
- No WAL checkpoint management
- No automatic reconnection attempt if DB becomes inaccessible

### 3. S7 PLC Connector (`src/s7-connector/index.ts`)

**Exists:**
- Automatic reconnection on connection failure via `scheduleReconnect()`
- Configurable reconnect interval (`reconnectIntervalMs`)
- Stale value marking — sets node quality to `"bad"` on disconnect, `"good"` on reconnect
- Connection state machine: `connected` → `disconnected`/`error` → reconnecting
- Read errors trigger disconnect + reconnect cycle
- Cleanup of old client before reconnection
- Guard against duplicate connection attempts (`connecting` flag)

**Missing:**
- No exponential backoff — uses a fixed interval reconnect
- No maximum reconnect attempts limit
- No jitter on reconnect timing
- No circuit breaker pattern

### 4. API Error Handling (`src/api/`, `src/types/api.ts`)

**Exists:**
- Structured error responses with consistent format
- Typed error codes: `VALIDATION_ERROR`, `DUPLICATE_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `RUNTIME_ERROR`
- Field-level validation error details (`ErrorDetail[]`)
- Global error handler middleware
- Route-level error mapping via `handleRepositoryError()`

**Missing:**
- No dedicated input validation middleware (Zod, Joi, or express-validator)
- No request rate limiting
- No request timeout middleware

### 5. Web UI (`web/src/`)

**Exists:**
- TanStack Query with `retry: 1` (one retry on failed queries)
- `refetchInterval` on server status (auto-polling)
- `StatusBar` component shows API connection status (green/red dot)
- Runtime state indicator in StatusBar
- Error states displayed in Dashboard
- Mutation error feedback shown inline

**Missing:**
- No React Error Boundary for catching rendering crashes
- No offline/reconnection banner or toast notifications
- No exponential backoff on retries
- No global query error handler (`onError`)

### 6. Health Checks

**Exists:**
- `GET /api/server/status` endpoint (unauthenticated)
- Returns: state, uptime, PID, connected clients, last error
- Runtime status read from `status.json`
- `isAccessible()` method on Database class

**Missing:**
- No combined health endpoint that checks all subsystems (DB + runtime + S7)
- No readiness/liveness probe distinction
- No S7 connection health included in server status

### 7. Logging (`src/log/index.ts`)

**Exists:**
- Centralized in-memory log service (singleton)
- Structured entries: `{ timestamp, level, source, message }`
- Four log levels: `debug`, `info`, `warn`, `error`
- Source tagging (e.g., `"Runtime"`, `"S7:ConnectionName"`)
- Ring buffer (max 1000 entries)
- Exposed via `GET /api/logs` endpoint
- Web UI log panel with level filtering and auto-scroll

**Missing:**
- No file-based logging (disk persistence)
- No log rotation
- No correlation IDs / request IDs
- No configurable log level threshold

---

## Requirements

Based on the gaps identified above, the following requirements are proposed to achieve robust error recovery:

### R1 — Automatic Runtime Restart with Backoff

Wire the existing `onCrash` callback to automatically restart the C runtime process. Implement exponential backoff (e.g., 1s, 2s, 4s, 8s, capped at 60s) with a maximum restart attempts counter. After exceeding max attempts, set state to `error` and stop retrying until manually triggered.

### R2 — SQLite Busy Timeout and Retry

Configure `PRAGMA busy_timeout` (e.g., 5000ms) on database initialization to handle transient `SQLITE_BUSY` errors from WAL concurrent access. Optionally add a retry wrapper for write operations.

### R3 — Database Integrity Check on Startup

Run `PRAGMA integrity_check` during database initialization. If corruption is detected, log a critical error and surface it via the status endpoint.

### R4 — Exponential Backoff for S7 Reconnection

Replace the fixed-interval reconnect with exponential backoff (starting at `reconnectIntervalMs`, doubling up to a configurable max). Add random jitter to prevent thundering herd when multiple connections fail simultaneously.

### R5 — React Error Boundary

Add a top-level React Error Boundary that catches rendering crashes, displays a fallback UI, and allows the user to retry or reload.

### R6 — Combined Health Endpoint

Create a `GET /api/health` endpoint that reports the aggregate status of all subsystems (database accessible, runtime state, S7 connection states) in a single response. Suitable for monitoring or container orchestration probes.

### R7 — Global UI Error Notifications

Add a global `onError` handler to the TanStack QueryClient that displays transient error toasts/banners when API requests fail. Show a persistent "Reconnecting..." banner when the API is unreachable.

### R8 — Input Validation Middleware

Adopt a schema validation library (e.g., Zod) for request body validation on mutating endpoints. Return `VALIDATION_ERROR` with field-level details on invalid input.

### R9 — File-Based Log Persistence (Optional)

Add optional disk logging with rotation (e.g., daily files, max size) so that logs survive process restarts. Keep in-memory ring buffer for the web UI.

### R10 — Rate Limiting (Optional)

Add rate limiting middleware on mutating API endpoints to prevent abuse or accidental flooding (e.g., `express-rate-limit` with sensible defaults).

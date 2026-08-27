# Error Recovery Audit

## Summary

This document assesses the current state of runtime error recovery strategies in the OPC UA Light Server project. The system has four main failure domains: the C runtime process, the SQLite database, multi-protocol PLC connections (S7, Modbus TCP, EtherNet/IP, PCCC), and OPC UA security enforcement. Each requires specific recovery mechanisms to maintain availability.

---

## What Already Exists

| Strategy | Implementation |
|----------|---------------|
| Crash detection | Process manager detects unexpected exits/errors and fires `onCrash` callbacks |
| Connector stop on crash | `onCrash` handler stops all connector polling when runtime crashes |
| Multi-protocol reconnection | `BaseConnector` automatic reconnect on failure with configurable interval (all protocols) |
| Quality propagation | IPC processor writes `BadNotConnected` status to OPC UA nodes when connector quality is "bad", restores `Good` on successful polls |
| Stale value marking | Sets node quality to `"bad"` on disconnect, `"good"` on reconnect (all connectors via BaseConnector) |
| WAL mode | Enabled in SQLite (implicit crash recovery) |
| DB cache fallback | `readWithCache()` returns last-known-good data when DB is inaccessible |
| Typed DB error | `DatabaseUnavailableError` class with `isAccessible()` health check |
| Structured API errors | Consistent `{ error: { code, message, details? } }` format with typed `ErrorCode` union |
| Params validation | `validateParams()` validates connection parameters against protocol schema before persisting |
| Security mode enforcement | Runtime restart after security policy change; API rejects mode change without certificate |
| Status endpoint | `GET /api/server/status` — unauthenticated, reports state/uptime/pid/clients/lastError/hostname/opcuaPort |
| Structured logging | Centralized `logService` with levels, sources, ring buffer, API endpoint, web panel |
| SSE real-time updates | Multiplexed Server-Sent Events stream replaces polling; fallback to polling when disconnected |
| UI connection indicator | StatusBar shows green/red/yellow dot for backend connectivity and runtime state |
| UI stale data banner | "Connection lost" warning banner when SSE is disconnected |
| UI error states | Dashboard shows error messages, mutations display inline failures |
| TanStack Query retries | Configured with `retry: 1` and auto-refetch on status |
| SSE fallback polling | `useSSE` hook enables periodic refetch when SSE is disconnected, disables when reconnected |
| Transient poll recovery | EtherNet/IP: TimeoutError/CIPError mark quality "bad" without reconnecting, next poll can recover |
| PCCC partial bad detection | Distinguishes all-items-bad (connection loss) from individual item failures |
| Global error safety nets | `uncaughtException` and `unhandledRejection` handlers prevent process crash from connector errors |
| TOFU certificate trust | Trust-on-first-use model auto-accepts unknown client certs, persists to disk, supports revocation |
| PKI trust store reload | Trust/reject/delete operations signal runtime via IPC without restart |
| Plugin loader resilience | Skips invalid plugins with detailed reasons; handles missing directories, import errors, duplicate types |

---

## What's Missing

| Strategy | Gap |
|----------|-----|
| Automatic restart | `onCrash` hook stops connectors but nothing wires up a restart. No backoff, no restart counter, no max attempts. |
| SQLITE_BUSY retry | No busy timeout configured, no retry loop on transient lock contention |
| DB integrity check | No `PRAGMA integrity_check` on startup |
| Exponential backoff (connectors) | All protocols use fixed-interval reconnect — no progressive delay or jitter |
| Circuit breaker | No circuit breaker on any external dependency (connectors, runtime) |
| Input validation middleware | No Zod/Joi/express-validator — validation lives ad-hoc in route handlers (except params validation) |
| React Error Boundary | Rendering crash in any component takes down the whole UI |
| Global query error handler | No `onError` in QueryClient — no toast/banner for transient network failures |
| Combined health endpoint | No single probe that checks DB + runtime + connectors together |
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
- Reload via SIGUSR1 (Linux/Mac) or named pipe (Windows)
- Status polling every 5s with SSE broadcasting
- Client session change detection via JSON diff
- Stdin pipe for IPC value updates to runtime

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

### 3. Connector System (`src/connectors/`)

**Exists:**
- `BaseConnector` abstract class handles all shared recovery logic for 4 protocols
- Automatic reconnection on connection failure via `scheduleReconnect()`
- Configurable reconnect interval (`reconnectIntervalMs`) per connection
- Quality updates propagated to OPC UA nodes via IPC (`BadNotConnected` / `Good`)
- Connection state machine: `connected` -> `disconnected`/`error` -> reconnecting
- Guard against duplicate connection attempts (`connecting` flag)
- Cleanup of old client before reconnection (`closeClient()` + `client = null`)
- Per-protocol error classification:
  - EtherNet/IP: ConnectionError/SessionError -> reconnect; TimeoutError/CIPError -> mark bad, no reconnect
  - Modbus: `isConnectionError()` heuristic (ECONNREFUSED, ECONNRESET, etc.) -> reconnect; individual read failure -> log only
  - PCCC: all-items-bad -> connection loss; individual item bad -> per-item quality
  - S7: any readAllItems error -> reconnect
- Plugin loader gracefully handles invalid/missing modules without crashing
- Connectors stopped when runtime crashes (prevents sending updates to a dead process)

**Missing:**
- No exponential backoff — all protocols use fixed-interval reconnect
- No maximum reconnect attempts limit
- No jitter on reconnect timing
- No circuit breaker pattern
- No per-connector health metric aggregation

### 4. Security Enforcement (`src/api/routes/security.ts`, `runtime/src/security/`)

**Exists:**
- Security mode change triggers full runtime restart (stop + start)
- Connectors stopped before restart and re-started after
- API rejects Sign/SignAndEncrypt without certificate configured (400 error)
- C runtime removes None endpoints in SignAndEncrypt mode (clients can't negotiate unencrypted)
- C runtime removes SignAndEncrypt endpoints in Sign mode
- None security policy retained for discovery service (GetEndpoints works)
- TOFU verifier accepts unknown certs on first use, persists to disk
- Trust store reload via IPC (no restart needed for cert trust/reject/delete)
- ConfigGenerator falls back to None with warning when PKI directories are missing

**Missing:**
- No certificate expiry auto-renewal or pre-expiry notification (beyond the UI indicator)
- No CRL (Certificate Revocation List) support beyond file-based TOFU reject store

### 5. API Error Handling (`src/api/`, `src/types/api.ts`)

**Exists:**
- Structured error responses with consistent format
- Typed error codes: `VALIDATION_ERROR`, `DUPLICATE_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `RUNTIME_ERROR`, `CERTIFICATE_NOT_FOUND`, `ACCESS_DENIED`, `CONFLICT`
- Field-level validation error details (`ErrorDetail[]`)
- Global error handler middleware
- Params validation against protocol schema (`validateParams()`)
- Auto-reload middleware triggers config regeneration + runtime reload on address space mutations
- Security policy validation (rejects mode change without cert)

**Missing:**
- No dedicated input validation middleware (Zod, Joi, or express-validator)
- No request rate limiting
- No request timeout middleware

### 6. Web UI (`web/src/`)

**Exists:**
- TanStack Query with `retry: 1` (one retry on failed queries)
- SSE connection with auto-reconnect and disconnect detection
- Fallback polling when SSE is disconnected (configurable intervals per query)
- StatusBar shows backend connectivity (green/yellow/red) and runtime state
- "Connection lost" warning banner when backend is unreachable
- Connector cards show color-coded status (green border = connected, red = error, gray = disconnected)
- Enable/disable toggle on connection cards (stops polling without deleting)
- SecurityModeCard guided flow: inline prompt to generate cert when needed
- Error states displayed in Dashboard
- Mutation error feedback shown inline
- Log panel with real-time SSE-streamed entries, level filtering, auto-scroll

**Missing:**
- No React Error Boundary for catching rendering crashes
- No toast notifications for transient errors
- No exponential backoff on query retries
- No global query error handler (`onError`)

### 7. Health Checks

**Exists:**
- `GET /api/server/status` endpoint (unauthenticated) — state, uptime, PID, connected clients, last error, hostname, opcuaPort
- `GET /api/connectors/status` — aggregated connector states per connection
- `GET /api/connectors/values` — live values with quality indicators
- `isAccessible()` method on Database class
- Docker HEALTHCHECK on `/api/server/status`
- Runtime `status.json` with per-client session details

**Missing:**
- No combined health endpoint that checks all subsystems (DB + runtime + connectors)
- No readiness/liveness probe distinction
- No connector health included in server status response

### 8. Logging (`src/log/index.ts`)

**Exists:**
- Centralized in-memory log service (singleton)
- Structured entries: `{ timestamp, level, source, message }`
- Four log levels: `debug`, `info`, `warn`, `error`
- Source tagging (e.g., `"S7:ConnectionName"`, `"Modbus:PLC1"`, `"EthernetIP:Line1"`, `"PCCC:SLC500"`)
- Ring buffer (max 1000 entries)
- Exposed via `GET /api/logs` endpoint with filtering (since, level, source)
- Real-time SSE broadcast (`log:entry` event)
- Web UI log panel with level toggle, auto-scroll, and clear
- Protocol-specific ring buffers (S7 and Modbus have `getLogs()` for protocol-level log access)

**Missing:**
- No file-based logging (disk persistence)
- No log rotation
- No correlation IDs / request IDs
- No configurable log level threshold

### 9. IPC Bridge (`src/connectors/core/ipc-bridge.ts`)

**Exists:**
- Resolves database UUIDs to OPC UA node IDs via cached map
- Lazy map building with auto-rebuild on cache miss
- Skips updates when runtime is not running
- Propagates quality field: "bad" -> `BadNotConnected`, "good" -> `Good` status code on OPC UA nodes
- Newline-delimited JSON protocol over stdin pipe

**Missing:**
- No backpressure handling (if stdin pipe fills up, updates are silently dropped)
- No batching/throttling of rapid updates
- No IPC health monitoring (detect when pipe is broken before write fails)

---

## Requirements

Based on the gaps identified above, the following requirements are proposed to achieve robust error recovery:

### R1 — Automatic Runtime Restart with Backoff

Wire the existing `onCrash` callback to automatically restart the C runtime process. Implement exponential backoff (e.g., 1s, 2s, 4s, 8s, capped at 60s) with a maximum restart attempts counter. After exceeding max attempts, set state to `error` and stop retrying until manually triggered.

### R2 — SQLite Busy Timeout and Retry

Configure `PRAGMA busy_timeout` (e.g., 5000ms) on database initialization to handle transient `SQLITE_BUSY` errors from WAL concurrent access. Optionally add a retry wrapper for write operations.

### R3 — Database Integrity Check on Startup

Run `PRAGMA integrity_check` during database initialization. If corruption is detected, log a critical error and surface it via the status endpoint.

### R4 — Exponential Backoff for Connector Reconnection

Replace the fixed-interval reconnect in `BaseConnector.scheduleReconnect()` with exponential backoff (starting at `reconnectIntervalMs`, doubling up to a configurable max, e.g., 60s). Add random jitter (0-25%) to prevent thundering herd when multiple connections fail simultaneously. Reset backoff on successful reconnection.

### R5 — React Error Boundary

Add a top-level React Error Boundary that catches rendering crashes, displays a fallback UI with error details, and allows the user to retry or reload the page.

### R6 — Combined Health Endpoint

Create a `GET /api/health` endpoint that reports the aggregate status of all subsystems (database accessible, runtime state, connector states summary) in a single response. Suitable for monitoring or container orchestration probes. Distinguish between liveness (process is alive) and readiness (all subsystems operational).

### R7 — Global UI Error Notifications

Add a global `onError` handler to the TanStack QueryClient that displays transient error toasts/banners when API requests fail. Differentiate between network errors (show reconnecting banner) and application errors (show inline).

### R8 — Input Validation Middleware

Adopt a schema validation library (e.g., Zod) for request body validation on mutating endpoints. Return `VALIDATION_ERROR` with field-level details on invalid input. Currently, params validation exists for connectors but not for other endpoints.

### R9 — File-Based Log Persistence (Optional)

Add optional disk logging with rotation (e.g., daily files, max size) so that logs survive process restarts. Keep in-memory ring buffer for the web UI. Configurable via environment variable (e.g., `LOG_FILE_PATH`).

### R10 — Rate Limiting (Optional)

Add rate limiting middleware on mutating API endpoints to prevent abuse or accidental flooding (e.g., `express-rate-limit` with sensible defaults like 100 requests/minute per IP).

### R11 — IPC Backpressure Handling (Optional)

Monitor stdin pipe writable state. If the pipe is full (write returns false), buffer updates and flush when drain event fires. Drop oldest updates if the buffer exceeds a threshold. Log warnings when updates are dropped.

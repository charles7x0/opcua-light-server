# Implementation Plan: SSE Real-Time Updates

## Overview

This plan replaces 8 HTTP polling loops in the React Web UI with a single Server-Sent Events (SSE) connection. The backend gains a `/api/events` endpoint powered by an `SseHub` class that broadcasts multiplexed events. The frontend gains a `useSSE` hook that injects received data directly into React Query's cache. Existing REST endpoints remain unchanged for mutations and external consumers.

## Tasks

- [x] 1. Implement SSE Hub (Backend Core)
  - [x] 1.1 Create `SseHub` class in `src/api/sse-hub.ts`
    - Implement `addClient(id, res)` — registers a Response object as an SSE client
    - Implement `removeClient(id)` — removes client and cleans up
    - Implement `broadcast(eventType, data)` — sends named event to all connected clients
    - Implement `sendToClient(id, eventType, data)` — sends event to a specific client
    - Implement `startHeartbeat()` — sends `:heartbeat\n\n` comment every 30 seconds
    - Implement `shutdown()` — stops heartbeat, disconnects all clients
    - Implement `getClientCount()` — returns number of connected clients
    - Format events as `event: {type}\ndata: {json}\n\n`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Write unit tests for SseHub in `tests/unit/sse-hub.test.ts`
    - Test client add/remove lifecycle
    - Test broadcast delivers to all clients
    - Test sendToClient delivers to specific client only
    - Test heartbeat sends `:heartbeat` comment at interval
    - Test shutdown disconnects all clients and stops heartbeat
    - Test removeClient handles already-removed client gracefully
    - _Requirements: 1.3, 1.4, 1.5_

- [x] 2. Implement SSE Route (Backend Endpoint)
  - [x] 2.1 Create events router in `src/api/routes/events.ts`
    - `GET /api/events` route handler
    - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    - Disable response buffering (`res.flushHeaders()`)
    - Generate unique client ID and register with SseHub
    - Send initial state events (server:status, server:clients, connector:status, connector:values)
    - Listen for `close` event and call `sseHub.removeClient()`
    - No authentication middleware on this route
    - _Requirements: 1.1, 1.6, 1.7, 2.4, 3.3, 5.3, 6.3_

  - [x] 2.2 Register events router in `src/api/app.ts`
    - Import and mount `createEventsRouter` at `/api/events`
    - Pass SseHub, ProcessManager, and ConnectorRegistry dependencies
    - _Requirements: 1.1_

  - [x] 2.3 Write unit tests for events route in `tests/unit/events-route.test.ts`
    - Test response headers are set correctly
    - Test client is registered with SseHub on connect
    - Test client is removed from SseHub on disconnect
    - Test initial state events are sent on connect
    - Test no authentication is required
    - _Requirements: 1.1, 1.5, 1.6, 1.7_

- [x] 3. Integrate Event Sources (Backend Emitters)
  - [x] 3.1 Add SSE event emission to ProcessManager
    - Emit `server:status` on `start()`, `stop()`, and `reload()` completion
    - Add a periodic status read timer (every 5 seconds) that emits `server:status` while running
    - Detect client session changes (compare previous sessions array) and emit `server:clients` on change
    - Pass SseHub reference via constructor or setter method
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [x] 3.2 Add SSE event emission to ConnectorRegistry
    - Emit `connector:status` when any connector's state transitions
    - Emit `connector:values` after each poll cycle returns new values
    - Pass SseHub reference via constructor or setter method
    - Only emit `connector:values` when at least one connector is active
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.4_

  - [x] 3.3 Add SSE event emission to LogService
    - Emit `log:entry` synchronously when a new log entry is appended
    - Include level, message, timestamp, and source in the event payload
    - Pass SseHub reference via constructor or setter method
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.4 Write integration test for SSE event delivery in `tests/integration/sse-events.test.ts`
    - Connect an SSE client and verify initial state events are received
    - Trigger a status change and verify `server:status` event arrives
    - Verify multiple clients receive the same events
    - Verify client cleanup on disconnect
    - _Requirements: 1.4, 2.4, 3.3, 5.3, 6.3_

- [x] 4. Checkpoint - Backend verification
  - Run all tests (unit + integration) and verify SSE endpoint works
  - Test with `curl` or `httpie`: `curl -N http://localhost:3100/api/events`
  - Verify heartbeat arrives every 30 seconds
  - Verify initial state events are sent on connect

- [x] 5. Implement Frontend SSE Hook
  - [x] 5.1 Create `useSSE` hook in `web/src/hooks/useSSE.ts`
    - Create `EventSource` connection to `/api/events` on mount
    - Track connection state: `connecting` | `connected` | `disconnected` | `fallback`
    - Set state to `connected` on EventSource `open` event
    - Set state to `disconnected` on EventSource `error` event
    - Count consecutive failures — transition to `fallback` after 3 failures
    - Clean up EventSource on unmount
    - Return `connectionState` for StatusBar consumption
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7_

  - [x] 5.2 Implement event-to-cache routing in `useSSE`
    - On `server:status` event: `queryClient.setQueryData(['serverStatus'], data)` and `queryClient.setQueryData(['server-status'], data)`
    - On `server:clients` event: `queryClient.setQueryData(['server', 'clients'], data)`
    - On `connector:status` event: `queryClient.setQueryData(['connectors-status'], data)` and `queryClient.setQueryData(['s7-status'], data)`
    - On `connector:values` event: `queryClient.setQueryData(['connectors-values'], data)` and `queryClient.setQueryData(['s7-values'], data)`
    - On `log:entry` event: dispatch to log stream subscribers
    - Parse event data with `JSON.parse`, ignore malformed events silently
    - _Requirements: 7.3, 7.4_

  - [x] 5.3 Create `useLogStream` hook in `web/src/hooks/useLogStream.ts`
    - Lightweight pub/sub for log entries from SSE
    - `subscribe(listener)` and `unsubscribe(listener)` pattern
    - Export a `logStream` singleton for useSSE to publish to
    - LogPanel consumes via `useLogStream(onEntry)` hook
    - _Requirements: 4.1, 9.1_

  - [x] 5.4 Implement fallback polling logic in `useSSE`
    - When `connectionState` transitions to `fallback`, re-enable refetchInterval on affected queries
    - Use `queryClient.setDefaultOptions` or per-query override to restore intervals
    - When SSE reconnects successfully, disable polling again
    - _Requirements: 7.7_

- [x] 6. Migrate Frontend Components to SSE
  - [x] 6.1 Mount `useSSE` in App component (`web/src/layout/App.tsx`)
    - Call `useSSE()` at the top level so SSE connection is app-wide
    - Pass `connectionState` down to StatusBar (via props or context)
    - _Requirements: 7.1, 7.6_

  - [x] 6.2 Remove `refetchInterval` from Dashboard queries (`web/src/screens/dashboard/Dashboard.tsx`)
    - Remove `refetchInterval: 5000` from `['serverStatus']` query
    - Remove `refetchInterval: 3000` from `['server', 'clients']` query
    - Keep `enabled: status?.state === 'running'` conditional on clients query
    - _Requirements: 7.4_

  - [x] 6.3 Remove `refetchInterval` from StatusBar query (`web/src/layout/StatusBar.tsx`)
    - Remove `refetchInterval: 3000` from `['server-status']` query
    - Keep security config query at `refetchInterval: 30000` (not SSE-managed)
    - Add SSE connection state indicator (green/yellow/red dot)
    - _Requirements: 7.4, 7.6_

  - [x] 6.4 Remove `refetchInterval` from ConnectorsManager queries (`web/src/screens/connectors/ConnectorsManager.tsx`)
    - Remove `refetchInterval: 5000` from `['connectors-status']` query
    - Remove `refetchInterval: 2000` from `['connectors-values']` query
    - _Requirements: 7.4_

  - [x] 6.5 Remove `refetchInterval` from S7ConnectionManager queries (`web/src/screens/s7/S7ConnectionManager.tsx`)
    - Remove `refetchInterval: 5000` from `['s7-status']` query
    - Remove `refetchInterval: 2000` from `['s7-values']` query
    - _Requirements: 7.4_

  - [x] 6.6 Rewrite LogPanel to use SSE stream (`web/src/layout/LogPanel.tsx`)
    - Remove the manual `setInterval` + `fetch` pattern
    - Subscribe to `useLogStream` hook to receive entries from SSE
    - Keep existing local state buffer (1000 entries max)
    - Keep level filtering and auto-scroll behavior unchanged
    - On panel open, show entries received since SSE connection started (no historical fetch)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 7. Checkpoint - Frontend verification
  - Verify real-time updates appear in Dashboard, StatusBar, ConnectorsManager, S7ConnectionManager
  - Verify LogPanel shows entries instantly
  - Verify SSE connection indicator in StatusBar
  - Test disconnection recovery (stop/start backend)
  - Test fallback to polling (block /api/events endpoint)

- [x] 8. Ensure Backward Compatibility
  - [x] 8.1 Verify existing REST endpoints still work unchanged
    - Confirm `GET /api/server/status` returns same shape
    - Confirm `GET /api/server/clients` returns same shape
    - Confirm `GET /api/connectors/status` returns same shape
    - Confirm `GET /api/connectors/values` returns same shape
    - Confirm `GET /api/logs` returns same shape
    - _Requirements: 8.1, 8.2_

  - [x] 8.2 Verify mutations still invalidate cache correctly
    - After `POST /api/server/start`, next SSE event updates status
    - After node CRUD operations, verify data consistency
    - After connector CRUD operations, verify status updates via SSE
    - _Requirements: 8.3, 8.4_

- [x] 9. Final checkpoint - Full integration verification
  - Run all tests (unit + property + integration + components)
  - Manual verification of all screens with SSE active
  - Verify no regressions in existing functionality

## Notes

- The SSE endpoint requires no new npm dependencies — Express natively supports streaming responses and the browser has native `EventSource` support
- The `SecurityConfig` query in StatusBar (30s polling) is intentionally NOT migrated — certificate expiry changes too rarely to justify event noise
- The S7 and Connectors screens share the same event data (connector:status, connector:values) — the useSSE hook updates both query key sets from a single event
- Query key consolidation (Dashboard uses `['serverStatus']`, StatusBar uses `['server-status']`) is handled by updating both keys from the same event rather than refactoring existing components
- All existing REST endpoints remain fully functional for external consumers, scripts, and curl-based testing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["5.1", "5.3"] },
    { "id": 6, "tasks": ["5.2", "5.4"] },
    { "id": 7, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 8, "tasks": ["8.1", "8.2"] }
  ]
}
```

# Requirements Document

## Introduction

This feature replaces the current HTTP polling pattern in the React Web UI with Server-Sent Events (SSE) for real-time data delivery. Currently, the frontend polls 8 separate REST endpoints at intervals between 2–5 seconds, creating unnecessary network traffic, duplicated requests, and delayed updates. SSE provides a single persistent HTTP connection where the server pushes events as they occur — delivering true real-time updates with lower latency and reduced resource consumption.

## Glossary

- **SSE**: Server-Sent Events — a W3C standard for server-to-client push over a persistent HTTP connection using the `text/event-stream` content type
- **EventSource**: The native browser API for consuming SSE streams, with built-in auto-reconnection
- **Control_API**: The Node.js/Express REST API that manages the OPC UA runtime and connector lifecycle
- **Web_UI**: The React Web UI that displays server status, logs, connector values, and client sessions
- **Event_Stream**: The single SSE endpoint that multiplexes all real-time event types
- **Event_Type**: A named category of SSE event (e.g., `server:status`, `connector:values`) used for client-side routing
- **Heartbeat**: A periodic SSE comment or event sent to keep the connection alive and detect disconnections
- **React_Query_Cache**: The TanStack React Query in-memory cache that the frontend uses for data management
- **Polling**: The current pattern where the frontend periodically calls REST endpoints at fixed intervals

## Requirements

### Requirement 1: SSE Endpoint

**User Story:** As a frontend developer, I want a single SSE endpoint that streams all real-time events, so that the UI receives updates immediately without polling multiple endpoints.

#### Acceptance Criteria

1. THE Control_API SHALL expose a `GET /api/events` endpoint that returns a response with `Content-Type: text/event-stream`
2. THE Control_API SHALL keep the `/api/events` connection open indefinitely until the client disconnects
3. THE Control_API SHALL send a heartbeat comment (`:heartbeat`) every 30 seconds to keep the connection alive
4. THE Control_API SHALL support multiple simultaneous SSE client connections
5. THE Control_API SHALL clean up resources (timers, listeners) when a client disconnects
6. THE Control_API SHALL set `Cache-Control: no-cache` and `Connection: keep-alive` headers on the SSE response
7. THE Control_API SHALL NOT require authentication on the `/api/events` endpoint, consistent with the existing status and clients endpoints

### Requirement 2: Server Status Events

**User Story:** As an operator, I want the dashboard and status bar to update instantly when the server state changes, so that I see accurate status without polling delays.

#### Acceptance Criteria

1. THE Control_API SHALL emit a `server:status` event whenever the runtime state changes (started, stopped, error)
2. THE Control_API SHALL emit a `server:status` event periodically (every 5 seconds) while the runtime is running, containing current uptime and client count
3. THE `server:status` event payload SHALL contain: state, uptime, pid, connectedClients, and lastError fields matching the existing `/api/server/status` response shape
4. THE Control_API SHALL emit a `server:status` event immediately when a new SSE client connects (initial state delivery)

### Requirement 3: Connected Clients Events

**User Story:** As an operator, I want the connected clients table to update immediately when clients connect or disconnect, so that I have real-time visibility into active sessions.

#### Acceptance Criteria

1. THE Control_API SHALL emit a `server:clients` event whenever the connected client sessions change (connect, disconnect, state change)
2. THE `server:clients` event payload SHALL contain an array of ClientSession objects matching the existing `/api/server/clients` response shape
3. THE Control_API SHALL emit a `server:clients` event immediately when a new SSE client connects (initial state delivery)
4. WHEN the runtime is not running, THE Control_API SHALL emit a `server:clients` event with an empty array

### Requirement 4: System Log Events

**User Story:** As an operator, I want log entries to appear in the log panel instantly as they are generated, so that I can monitor system activity in real time.

#### Acceptance Criteria

1. THE Control_API SHALL emit a `log:entry` event for each new log entry as it is created
2. THE `log:entry` event payload SHALL contain: level, message, timestamp, and source fields matching the existing log entry structure
3. THE Control_API SHALL NOT replay historical log entries when a new SSE client connects
4. THE Control_API SHALL emit log events regardless of the log panel being open on any connected UI client

### Requirement 5: Connector Status Events

**User Story:** As an operator, I want connector status changes (connected, disconnected, error) to appear immediately, so that I can react quickly to PLC communication issues.

#### Acceptance Criteria

1. THE Control_API SHALL emit a `connector:status` event whenever any connector's state changes (connected, disconnected, error, reconnecting)
2. THE `connector:status` event payload SHALL contain an array of all connector statuses matching the existing `/api/connectors/status` response shape
3. THE Control_API SHALL emit a `connector:status` event immediately when a new SSE client connects (initial state delivery)

### Requirement 6: Connector Live Values Events

**User Story:** As an operator, I want live PLC values to update in real time as the connectors poll them, so that I see current process data without the UI adding extra polling delay.

#### Acceptance Criteria

1. THE Control_API SHALL emit a `connector:values` event whenever connector values are updated from a PLC poll cycle
2. THE `connector:values` event payload SHALL contain an array of current value objects matching the existing `/api/connectors/values` response shape
3. THE Control_API SHALL emit a `connector:values` event immediately when a new SSE client connects (initial state delivery)
4. THE Control_API SHALL NOT emit a `connector:values` event if no connectors are active

### Requirement 7: Frontend SSE Integration

**User Story:** As a frontend developer, I want a reusable hook that manages the SSE connection and updates the React Query cache, so that existing components receive real-time data without code changes to their rendering logic.

#### Acceptance Criteria

1. THE Web_UI SHALL establish a single SSE connection to `GET /api/events` on application mount
2. THE Web_UI SHALL automatically reconnect to the SSE endpoint when the connection is lost (using EventSource built-in retry)
3. THE Web_UI SHALL update the React_Query_Cache for the relevant query keys when an SSE event is received
4. THE Web_UI SHALL remove all `refetchInterval` configurations from queries that are served by SSE events
5. THE Web_UI SHALL retain the last received data when the SSE connection is temporarily lost (no flickering)
6. WHEN the SSE connection is active, THE Web_UI SHALL display a visual indicator of real-time connectivity status in the StatusBar
7. THE Web_UI SHALL fall back to polling if the SSE connection cannot be established after 3 retry attempts

### Requirement 8: Backward Compatibility

**User Story:** As a maintainer, I want the existing REST endpoints to continue working unchanged, so that external consumers and scripts are not affected by the SSE addition.

#### Acceptance Criteria

1. THE Control_API SHALL continue to serve all existing REST endpoints (`/api/server/status`, `/api/server/clients`, `/api/connectors/status`, `/api/connectors/values`, `/api/logs`) with unchanged response shapes
2. THE Control_API SHALL NOT modify the behavior or response format of any existing REST endpoint
3. THE Web_UI SHALL continue to use REST endpoints for all mutation operations (POST, PUT, DELETE)
4. THE Web_UI SHALL invalidate relevant React Query cache entries after successful mutations to trigger fresh data via SSE

### Requirement 9: LogPanel Migration

**User Story:** As a developer, I want the LogPanel to consume log entries from the SSE stream instead of its manual polling interval, so that logs appear instantly and the polling code can be removed.

#### Acceptance Criteria

1. THE LogPanel SHALL receive log entries from the SSE `log:entry` events instead of polling `GET /api/logs`
2. THE LogPanel SHALL continue to buffer up to 1000 log entries in local state
3. THE LogPanel SHALL continue to support level filtering (info, warn, error) on received events
4. THE LogPanel SHALL continue to auto-scroll to the latest entry when auto-scroll is enabled
5. WHEN the LogPanel is opened, THE LogPanel SHALL display only log entries received since the SSE connection was established (no historical replay)

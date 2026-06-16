# Implementation Plan: Connected Clients Dashboard

## Overview

This plan implements per-client session visibility on the Server Dashboard. The data flows from the C runtime (writing sessions to `status.json`) through the Control API (new `/api/server/clients` endpoint) to the React Dashboard (polling and rendering a sessions table). All changes maintain backward compatibility with the existing `connectedClients` count and `/api/server/status` endpoint.

## Tasks

- [x] 1. Define types and session validation logic
  - [x] 1.1 Add ClientSession type definitions to `src/types/index.ts`
    - Add `ClientSessionState` union type with values `'Created' | 'Activated' | 'Closing'`
    - Add `ClientSession` interface with fields: applicationName, applicationUri, securityPolicyUri, clientAddress, connectTime, sessionState
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.2 Implement `validateSessions` utility function in `src/process-manager/validate-sessions.ts`
    - Pure function that accepts `unknown` input and returns `ClientSession[]`
    - Validates each entry has all required fields with correct types
    - Filters out entries with invalid `sessionState` values
    - Filters out entries with invalid `connectTime` (non-ISO 8601)
    - Returns empty array if input is not an array
    - _Requirements: 1.4, 2.4, 6.2_

  - [x] 1.3 Write property test for session validation (Property 1: Session Data Round-Trip Preservation)
    - **Property 1: Session Data Round-Trip Preservation**
    - **Validates: Requirements 1.4, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    - Test file: `tests/property/client-sessions.test.ts`
    - Generate arbitrary valid ClientSession arrays and verify `validateSessions` preserves all fields
    - Generate invalid/malformed entries and verify they are filtered out

- [x] 2. Implement backend API layer
  - [x] 2.1 Add `readClientSessions()` method to ProcessManager in `src/process-manager/`
    - Read and parse `status.json`, extract `sessions` field
    - Use `validateSessions` to validate and filter session data
    - Return `[]` if: file doesn't exist, sessions field missing, runtime not running, or parse error
    - Maintain existing `connectedClients` numeric field behavior unchanged
    - _Requirements: 1.1, 1.4, 1.5, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3_

  - [x] 2.2 Add `GET /api/server/clients` route to `src/api/routes/server.ts`
    - Call `processManager.readClientSessions()` and return the result as JSON
    - Return HTTP 200 with an array of ClientSession objects
    - Return empty array `[]` when runtime is not running or no sessions exist
    - No authentication required (consistent with existing status endpoint)
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

  - [x] 2.3 Write unit tests for the clients endpoint in `tests/unit/server-routes.test.ts`
    - Test returns `[]` when server is stopped
    - Test returns `[]` when status file has no sessions field
    - Test returns valid sessions array when runtime is running
    - Test endpoint requires no authentication
    - Test existing `/api/server/status` response remains unchanged
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 6.3_

- [x] 3. Checkpoint - Backend verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement duration formatting utility
  - [x] 4.1 Create `formatRelativeDuration` utility in `web/src/utils/formatRelativeDuration.ts`
    - Pure function accepting an ISO 8601 timestamp string
    - Returns human-readable relative duration (e.g., "5m 30s", "2h 15m", "3d 4h")
    - Handles edge cases: future timestamps, just now, very long durations
    - _Requirements: 5.4_

  - [x] 4.2 Write property test for duration formatting (Property 3: Relative Duration Formatting Correctness)
    - **Property 3: Relative Duration Formatting Correctness**
    - **Validates: Requirements 5.4**
    - Test file: `tests/property/client-sessions.test.ts`
    - Generate arbitrary past ISO timestamps and verify output is non-empty
    - Verify formatted output correctly represents elapsed time within 1-second tolerance

- [x] 5. Implement frontend API client and components
  - [x] 5.1 Add `ClientSession` interface and `getConnectedClients` function to `web/src/api.ts`
    - Define `ClientSession` interface matching backend response
    - Implement `getConnectedClients()` function using existing `request` utility
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.2 Create `ConnectedClientsTable` component in `web/src/components/ConnectedClientsTable.tsx`
    - Accept `sessions: ClientSession[]` prop
    - Render a table with columns: App Name, App URI, Security Policy, Address, Connected (duration), State
    - Use `formatRelativeDuration` for the connection time column
    - Display "No clients connected" message when sessions array is empty
    - Style consistently with existing dashboard components using Tailwind CSS
    - _Requirements: 4.1, 4.2, 4.3, 5.4_

  - [x] 5.3 Write property test for rendering completeness (Property 2: Session Rendering Completeness)
    - **Property 2: Session Rendering Completeness**
    - **Validates: Requirements 4.1, 4.2**
    - Test file: `tests/components/ConnectedClientsTable.test.tsx`
    - Generate arbitrary valid session arrays and verify one row per session is rendered
    - Verify each row contains all field values from the corresponding session

  - [x] 5.4 Write unit tests for `ConnectedClientsTable` component in `tests/components/ConnectedClientsTable.test.tsx`
    - Test empty state message is shown when no sessions
    - Test all columns are rendered for each session
    - Test duration formatting is applied to connectTime
    - _Requirements: 4.2, 4.3_

- [x] 6. Integrate into Dashboard with polling
  - [x] 6.1 Integrate `ConnectedClientsTable` into `web/src/components/Dashboard.tsx`
    - Add TanStack React Query hook to poll `GET /api/server/clients` every 3 seconds
    - Conditionally render the clients table only when server state is `'running'`
    - Hide the connected clients section when server is stopped
    - Retain last successful data on poll failure (React Query default behavior)
    - _Requirements: 4.1, 4.4, 5.1, 5.2, 5.3_

  - [x] 6.2 Write unit test for Dashboard conditional rendering in `tests/components/Dashboard.test.tsx`
    - Test clients table is hidden when server is stopped
    - Test clients table is shown when server is running
    - _Requirements: 4.4_

- [x] 7. Extend C runtime to write sessions to status.json
  - [x] 7.1 Modify `runtime/src/main.c` to include session details in status file
    - Iterate over active sessions using open62541 session management APIs
    - For each session, extract: applicationName, applicationUri, securityPolicyUri, clientAddress, connectTime, sessionState
    - Write a `sessions` JSON array alongside the existing `connectedClients` field
    - Write an empty `sessions: []` array when no clients are connected
    - Preserve the existing `connectedClients` numeric field for backward compatibility
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1_

- [x] 8. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific scenarios and edge cases
- The C runtime task (7.1) is independent of the TypeScript tasks and can be developed in parallel
- The frontend polling interval is 3 seconds as specified in the design (within the 5-second maximum from Requirement 5.1)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "4.2", "5.1"] },
    { "id": 2, "tasks": ["1.3", "2.1", "5.2"] },
    { "id": 3, "tasks": ["2.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["2.3", "6.1"] },
    { "id": 5, "tasks": ["6.2"] }
  ]
}
```

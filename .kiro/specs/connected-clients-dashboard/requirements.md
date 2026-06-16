# Requirements Document

## Introduction

This feature extends the existing Server Dashboard to display detailed information about each connected OPC UA client session. Currently the dashboard only shows a total connected client count. This feature will expose per-client details including application name, application URI, security policy, connection time, session state, and IP address — providing operators with full visibility into who is connected and how.

## Glossary

- **Runtime**: The open62541-based C process that serves OPC UA clients on port 4840
- **Control_API**: The Node.js/Express REST API that manages the Runtime lifecycle and configuration
- **Dashboard**: The React Web UI page displaying server status, uptime, and connected client information
- **Client_Session**: An active OPC UA session established by a remote client application on the Runtime
- **Status_File**: The `status.json` file written by the Runtime, read by the Control_API for status reporting
- **IPC_Channel**: The stdin pipe used for JSON message communication from Control_API to the Runtime

## Requirements

### Requirement 1: Runtime Exposes Client Session Details

**User Story:** As an operator, I want the runtime to report details about each connected client session, so that the Control API can serve this information to the dashboard.

#### Acceptance Criteria

1. WHILE the Runtime is running, THE Runtime SHALL write an array of connected client session objects to the Status_File on each status update cycle
2. WHEN a client session is established, THE Runtime SHALL include the session in the Status_File within the next status update cycle
3. WHEN a client session is terminated, THE Runtime SHALL remove the session from the Status_File within the next status update cycle
4. THE Runtime SHALL include the following fields for each Client_Session: applicationName, applicationUri, securityPolicyUri, clientAddress, connectTime, and sessionState
5. WHEN the Runtime has zero connected clients, THE Runtime SHALL write an empty array for the sessions field in the Status_File

### Requirement 2: Control API Serves Client Session Details

**User Story:** As a frontend developer, I want an API endpoint that returns connected client details, so that the dashboard can display session information.

#### Acceptance Criteria

1. THE Control_API SHALL expose a GET `/api/server/clients` endpoint that returns an array of connected Client_Session objects
2. THE Control_API SHALL read client session data from the Status_File written by the Runtime
3. WHEN the Runtime is not running, THE Control_API SHALL return an empty array from the clients endpoint
4. WHEN the Status_File does not contain session data, THE Control_API SHALL return an empty array
5. THE Control_API SHALL serve the clients endpoint without requiring authentication, consistent with the existing status endpoint

### Requirement 3: Client Session Data Structure

**User Story:** As a developer, I want a well-defined data structure for client session information, so that all layers use consistent field names and types.

#### Acceptance Criteria

1. THE Control_API SHALL return each Client_Session with a `applicationName` field of type string representing the client application display name
2. THE Control_API SHALL return each Client_Session with a `applicationUri` field of type string representing the client application URI
3. THE Control_API SHALL return each Client_Session with a `securityPolicyUri` field of type string representing the negotiated security policy (e.g., "http://opcfoundation.org/UA/SecurityPolicy#None")
4. THE Control_API SHALL return each Client_Session with a `clientAddress` field of type string representing the remote IP address and port of the client
5. THE Control_API SHALL return each Client_Session with a `connectTime` field of type string in ISO 8601 format representing when the session was established
6. THE Control_API SHALL return each Client_Session with a `sessionState` field of type string with possible values "Created", "Activated", or "Closing"

### Requirement 4: Dashboard Displays Client Session Table

**User Story:** As an operator, I want to see a table of connected clients on the dashboard, so that I can identify who is connected to the server and their connection details.

#### Acceptance Criteria

1. WHILE the Runtime is running, THE Dashboard SHALL display a table listing all connected Client_Sessions
2. THE Dashboard SHALL display columns for application name, application URI, security policy, client address, connection time, and session state
3. WHEN there are zero connected clients, THE Dashboard SHALL display a message indicating no clients are connected
4. WHEN the Runtime is not running, THE Dashboard SHALL hide the connected clients section

### Requirement 5: Dashboard Near Real-Time Updates

**User Story:** As an operator, I want the connected clients list to update automatically, so that I can monitor connections without manual page refreshes.

#### Acceptance Criteria

1. THE Dashboard SHALL poll the clients endpoint at a regular interval not exceeding 5 seconds
2. WHEN the clients data changes between polls, THE Dashboard SHALL reflect the updated data without requiring user interaction
3. WHEN a poll request fails, THE Dashboard SHALL retain the last successfully fetched data and retry on the next interval
4. THE Dashboard SHALL display the connection time as a human-readable relative duration (e.g., "5 minutes ago" or "2h 15m")

### Requirement 6: Status File Backward Compatibility

**User Story:** As a maintainer, I want the status file changes to be backward-compatible, so that existing functionality continues to work without modification.

#### Acceptance Criteria

1. THE Runtime SHALL continue to include the `connectedClients` numeric field in the Status_File alongside the new sessions array
2. WHEN the Control_API reads a Status_File without a sessions field, THE Control_API SHALL treat the sessions list as empty without error
3. THE Control_API SHALL continue to return the `connectedClients` count in the existing `/api/server/status` response without modification

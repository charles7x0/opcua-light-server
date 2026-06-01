# Requirements Document

## Introduction

OPC UA Light Server is a lightweight, production-ready MVP that provides an OPC UA server runtime built on open62541 (C), managed through a Node.js control API and a React-based web UI, with SQLite for persistent storage. The system enables operators and integrators to manage OPC UA nodes, namespaces, and security from a browser, control the server lifecycle (start/stop/reload), and optionally connect to Siemens S7 PLCs to expose PLC data over OPC UA.

### Problem Statement

Industrial environments need OPC UA servers to expose process data to SCADA, MES, and cloud systems. Existing solutions are either heavyweight commercial products or require deep C/C++ expertise to configure. There is no simple, web-managed OPC UA server that allows operators to define address spaces, manage security, and integrate PLC data sources without writing code.

### Target Users

- **Plant Operators**: Monitor and manage the OPC UA server status and node values via the web UI.
- **System Integrators**: Configure namespaces, folders, nodes, security policies, and S7 connections.
- **Developers**: Extend the system through the REST API or add new data source connectors.

### MVP Scope

The MVP delivers a functional OPC UA server with web-based CRUD management of the address space, server lifecycle control, basic security configuration, and an optional S7 connector for reading PLC data.

## Glossary

- **OPC_UA_Runtime**: The open62541-based C process that hosts the OPC UA server and exposes the address space to OPC UA clients.
- **Control_API**: The Node.js REST API that manages configuration, persists data to SQLite, and controls the OPC_UA_Runtime lifecycle.
- **Web_UI**: The React-based single-page application that provides a graphical interface for managing the system.
- **Address_Space**: The hierarchical structure of namespaces, folders, and nodes exposed by the OPC_UA_Runtime.
- **Node**: An OPC UA variable node with a name, data type, value, and metadata, belonging to a namespace and optionally a folder.
- **Namespace**: A named grouping within the Address_Space that organizes nodes logically (e.g., per device or subsystem).
- **Folder**: A hierarchical container within a Namespace used to organize Nodes in a tree structure.
- **S7_Connector**: An optional module that reads data from Siemens S7 PLCs using the S7 protocol and maps PLC variables to OPC UA Nodes.
- **SQLite_Store**: The SQLite database used by the Control_API to persist node definitions, namespace configurations, S7 mappings, and security settings.
- **Security_Policy**: A configuration that defines the OPC UA security mode (None, Sign, SignAndEncrypt) and associated certificates.

## Requirements

### Requirement 1: Node Management

**User Story:** As a system integrator, I want to create, read, update, and delete OPC UA nodes through the web UI and API, so that I can define the address space without writing code.

#### Acceptance Criteria

1. WHEN a user submits a valid node definition (name, data type, namespace, optional folder, optional initial value), THE Control_API SHALL create the node in the SQLite_Store and return the created node with a unique identifier.
2. WHEN a user requests the list of nodes, THE Control_API SHALL return all nodes with their current configuration and metadata.
3. WHEN a user submits an update to an existing node, THE Control_API SHALL persist the changes to the SQLite_Store and return the updated node.
4. WHEN a user requests deletion of a node, THE Control_API SHALL remove the node from the SQLite_Store and return a confirmation.
5. IF a node definition contains invalid data (missing required fields, unsupported data type, duplicate name within namespace), THEN THE Control_API SHALL return a descriptive error message with the specific validation failure.

### Requirement 2: Namespace Management

**User Story:** As a system integrator, I want to create and manage namespaces, so that I can organize the OPC UA address space by device or subsystem.

#### Acceptance Criteria

1. WHEN a user submits a valid namespace definition (unique name, optional description), THE Control_API SHALL create the namespace in the SQLite_Store and return the created namespace with a unique identifier.
2. WHEN a user requests the list of namespaces, THE Control_API SHALL return all namespaces with their node counts.
3. WHEN a user submits an update to an existing namespace, THE Control_API SHALL persist the changes and return the updated namespace.
4. WHEN a user requests deletion of a namespace, THE Control_API SHALL remove the namespace and all associated folders and nodes from the SQLite_Store.
5. IF a namespace name already exists, THEN THE Control_API SHALL return an error indicating the duplicate name conflict.

### Requirement 3: Folder Management

**User Story:** As a system integrator, I want to organize nodes into folders within namespaces, so that the address space has a clear hierarchical structure.

#### Acceptance Criteria

1. WHEN a user submits a valid folder definition (name, parent namespace, optional parent folder), THE Control_API SHALL create the folder in the SQLite_Store and return the created folder with a unique identifier.
2. WHEN a user requests the folder tree for a namespace, THE Control_API SHALL return the hierarchical folder structure including nested folders.
3. WHEN a user requests deletion of a folder, THE Control_API SHALL remove the folder, reassign contained nodes to the parent folder or namespace root, and return a confirmation.
4. IF a folder name is duplicated within the same parent, THEN THE Control_API SHALL return an error indicating the duplicate name conflict.

### Requirement 4: Server Lifecycle Control

**User Story:** As a plant operator, I want to start, stop, and reload the OPC UA server from the web UI, so that I can manage the server without command-line access.

#### Acceptance Criteria

1. WHEN a user issues a start command, THE Control_API SHALL launch the OPC_UA_Runtime process with the current configuration from the SQLite_Store.
2. WHEN a user issues a stop command, THE Control_API SHALL gracefully terminate the OPC_UA_Runtime process and confirm the shutdown.
3. WHEN a user issues a reload command, THE Control_API SHALL regenerate the address space configuration from the SQLite_Store and instruct the OPC_UA_Runtime to reload without full restart.
4. WHILE the OPC_UA_Runtime is running, THE Control_API SHALL report the server status as "running" with uptime information.
5. WHILE the OPC_UA_Runtime is stopped, THE Control_API SHALL report the server status as "stopped".
6. IF the OPC_UA_Runtime process crashes unexpectedly, THEN THE Control_API SHALL detect the termination, update the status to "error", and log the failure reason.

### Requirement 5: Address Space Synchronization

**User Story:** As a system integrator, I want the OPC UA runtime to reflect the node definitions stored in the database, so that changes made through the UI are exposed to OPC UA clients.

#### Acceptance Criteria

1. WHEN the OPC_UA_Runtime starts, THE OPC_UA_Runtime SHALL build the address space from the configuration file generated by the Control_API.
2. WHEN a reload command is issued, THE Control_API SHALL generate an updated configuration file from the SQLite_Store and signal the OPC_UA_Runtime to reload the address space.
3. THE Control_API SHALL generate the configuration file in a JSON format that the OPC_UA_Runtime can parse.
4. FOR ALL valid node definitions in the SQLite_Store, parsing the generated configuration then regenerating it SHALL produce an equivalent configuration (round-trip property).

### Requirement 6: Security Configuration

**User Story:** As a system integrator, I want to configure OPC UA security policies and manage certificates, so that the server meets the security requirements of the deployment environment.

#### Acceptance Criteria

1. WHEN a user selects a security mode (None, Sign, SignAndEncrypt), THE Control_API SHALL persist the Security_Policy to the SQLite_Store.
2. WHEN a user uploads a server certificate and private key, THE Control_API SHALL validate the certificate format and store the file paths in the SQLite_Store.
3. WHEN the OPC_UA_Runtime starts with a Security_Policy other than None, THE OPC_UA_Runtime SHALL load the configured certificate and enforce the selected security mode.
4. IF a certificate file is missing or invalid at startup, THEN THE Control_API SHALL report a configuration error and prevent the OPC_UA_Runtime from starting with that Security_Policy.
5. WHEN a user requests the current security configuration, THE Control_API SHALL return the active Security_Policy and certificate status without exposing private key contents.

### Requirement 7: S7 Connector (Optional Module)

**User Story:** As a system integrator, I want to connect to Siemens S7 PLCs and map PLC variables to OPC UA nodes, so that PLC data is accessible to OPC UA clients without custom code.

#### Acceptance Criteria

1. WHERE the S7_Connector module is enabled, WHEN a user submits a valid S7 connection definition (PLC IP address, rack, slot), THE Control_API SHALL create the connection configuration in the SQLite_Store.
2. WHERE the S7_Connector module is enabled, WHEN a user defines a mapping between a PLC variable (DB number, offset, data type) and an OPC UA Node, THE Control_API SHALL persist the mapping in the SQLite_Store.
3. WHERE the S7_Connector module is enabled, WHILE the OPC_UA_Runtime is running and an S7 connection is active, THE S7_Connector SHALL read mapped PLC variables at the configured polling interval and update the corresponding OPC UA Node values.
4. WHERE the S7_Connector module is enabled, IF the S7_Connector loses connection to a PLC, THEN THE S7_Connector SHALL set the quality status of affected nodes to "bad" and attempt reconnection at a configurable interval.
5. WHERE the S7_Connector module is enabled, WHEN a user requests the status of S7 connections, THE Control_API SHALL return the connection state (connected, disconnected, error) for each configured PLC.

### Requirement 8: Web UI Node Management

**User Story:** As a plant operator, I want to view and manage the OPC UA address space from a web browser, so that I can perform configuration tasks without specialized tools.

#### Acceptance Criteria

1. WHEN a user navigates to the Web_UI, THE Web_UI SHALL display the address space as a navigable tree of namespaces, folders, and nodes.
2. WHEN a user selects a node in the tree, THE Web_UI SHALL display the node details (name, data type, current value, metadata) in a detail panel.
3. WHEN a user submits a node creation form with valid data, THE Web_UI SHALL call the Control_API and display the new node in the tree upon success.
4. WHEN a user submits a node edit form, THE Web_UI SHALL call the Control_API and reflect the updated values in the tree upon success.
5. IF the Control_API returns a validation error, THEN THE Web_UI SHALL display the error message adjacent to the relevant form field.

### Requirement 9: Web UI Server Dashboard

**User Story:** As a plant operator, I want to see the OPC UA server status and control it from a dashboard, so that I can monitor and manage the server at a glance.

#### Acceptance Criteria

1. THE Web_UI SHALL display the current OPC_UA_Runtime status (running, stopped, error) on the dashboard.
2. WHEN the server status changes, THE Web_UI SHALL update the displayed status within 5 seconds.
3. WHEN a user clicks the start button, THE Web_UI SHALL call the Control_API start endpoint and update the dashboard status upon response.
4. WHEN a user clicks the stop button, THE Web_UI SHALL call the Control_API stop endpoint and update the dashboard status upon response.
5. WHEN a user clicks the reload button, THE Web_UI SHALL call the Control_API reload endpoint and display a confirmation upon success.
6. WHILE the OPC_UA_Runtime is running, THE Web_UI SHALL display the server uptime and connected client count.

### Requirement 10: Data Persistence

**User Story:** As a system integrator, I want all configuration to be persisted in SQLite, so that the system retains its state across restarts.

#### Acceptance Criteria

1. THE SQLite_Store SHALL persist all node definitions, namespace configurations, folder structures, S7 mappings, and security settings.
2. WHEN the Control_API starts, THE Control_API SHALL initialize the SQLite_Store schema if the database file does not exist.
3. WHEN the Control_API starts with an existing database, THE Control_API SHALL validate the schema version and apply migrations if needed.
4. IF the SQLite_Store becomes inaccessible during operation, THEN THE Control_API SHALL return a service unavailable error for write operations and serve cached data for read operations where possible.

### Requirement 11: API Authentication

**User Story:** As a system integrator, I want the Control API to require authentication, so that unauthorized users cannot modify the OPC UA server configuration.

#### Acceptance Criteria

1. THE Control_API SHALL require a valid API key or JWT token for all mutating endpoints (POST, PUT, DELETE).
2. WHEN a request lacks valid authentication credentials, THE Control_API SHALL return a 401 Unauthorized response.
3. WHEN a request contains expired or invalid credentials, THE Control_API SHALL return a 401 Unauthorized response with a descriptive error.
4. THE Control_API SHALL allow unauthenticated read access to the server status endpoint for health monitoring.

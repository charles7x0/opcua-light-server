# Bugfix Requirements Document

## Introduction

The unified Connectors screen (`ConnectorsManager.tsx`) was scaffolded with placeholder elements instead of integrating the fully-implemented subcomponents (`ProtocolSelector`, `ConnectionForm`, `ConnectionCard`, `MappingTable`, `CsvImportExport`). Users cannot create, edit, or delete connections through the Connectors screen, and mappings are not displayed. The working S7 Connection Manager screen demonstrates the expected level of functionality that this screen should replicate for all protocol types (S7, Modbus TCP, EtherNet/IP).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user clicks "+ New Connection" in the Connectors screen THEN the system shows a placeholder `<p>` tag saying "Protocol selection flow (coming soon)" instead of the `ProtocolSelector` component

1.2 WHEN a user wants to create a new connection after selecting a protocol THEN the system provides no `ConnectionForm` component — there is no way to fill in connection details and submit

1.3 WHEN connections exist and are listed in the Connectors screen THEN the system renders inline minimal `<div>` cards without Edit/Delete buttons instead of using the `ConnectionCard` component

1.4 WHEN a user expands a connection card to view mappings THEN the system shows "Mappings table placeholder" text inside `ConnectionCard` instead of rendering the `MappingTable` component with live values

1.5 WHEN a user attempts to edit or delete a connection via the Connectors screen THEN the system has no mutation functions wired — `createConnection`, `updateConnection`, and `deleteConnection` from the API module are not called

1.6 WHEN connections exist with mappings THEN the system does not fetch or display mappings data, nor does it provide CSV import/export functionality via the `CsvImportExport` component

### Expected Behavior (Correct)

2.1 WHEN a user clicks "+ New Connection" in the Connectors screen THEN the system SHALL render the `ProtocolSelector` component allowing the user to choose S7, Modbus TCP, or EtherNet/IP

2.2 WHEN a user selects a protocol from the `ProtocolSelector` THEN the system SHALL render the `ConnectionForm` component with the correct protocol-specific fields, allowing the user to create a new connection via the `createConnection` API

2.3 WHEN connections exist THEN the system SHALL render each connection using the `ConnectionCard` component with Edit and Delete buttons, protocol badge, status badge, and expand/collapse for mappings

2.4 WHEN a user expands a connection card THEN the system SHALL render the `MappingTable` component showing all mappings for that connection with live values, add/remove mapping functionality, and device-address placeholders appropriate to the protocol type

2.5 WHEN a user clicks Edit on a connection card THEN the system SHALL open the `ConnectionForm` in edit mode pre-filled with the connection's current data, and submit changes via the `updateConnection` API

2.6 WHEN a user clicks Delete on a connection card and confirms THEN the system SHALL call the `deleteConnection` API and remove the connection from the list

2.7 WHEN the Connectors screen is active THEN the system SHALL display the `CsvImportExport` component allowing bulk import/export of connector mappings

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the protocol filter tabs (All, S7, Modbus TCP, EtherNet/IP) are used THEN the system SHALL CONTINUE TO filter displayed connections by type

3.2 WHEN connections are loading THEN the system SHALL CONTINUE TO show the "Loading connections..." message with aria-live polite

3.3 WHEN no connections exist and the form is not shown THEN the system SHALL CONTINUE TO display the empty state message "No connections configured"

3.4 WHEN the S7 Connection Manager screen (`/s7`) is accessed directly THEN the system SHALL CONTINUE TO function independently with its own S7-specific components

3.5 WHEN connection status is polled (every 5 seconds) THEN the system SHALL CONTINUE TO show real-time status badges (connected/disconnected/error) on each connection card

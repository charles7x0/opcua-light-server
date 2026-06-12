# Requirements Document

## Introduction

The certificate-export feature enables users to download the OPC UA server's public certificate from the web UI or via REST API. OPC UA clients (UaExpert, Prosys OPC UA Browser, etc.) require the server's public certificate to establish secure connections. Currently, the server generates a self-signed certificate at `./data/certs/server.der` but provides no mechanism to export it. This feature adds a download endpoint, a UI download button, certificate remaining days in the status bar for at-a-glance health monitoring, and file browse dialogs for the certificate upload form so users don't need to manually type file paths.

## Glossary

- **Certificate_Export_API**: The REST API endpoint responsible for reading the server certificate file from disk and serving it as a downloadable response.
- **SecuritySettings_UI**: The React component (`SecuritySettings.tsx`) that renders security configuration controls, including the new download button.
- **StatusBar_UI**: The React component (`StatusBar.tsx`) that renders the fixed footer bar with server status indicators, including the certificate days remaining.
- **DER_Format**: A binary encoding format for X.509 certificates, commonly used by OPC UA clients.
- **PEM_Format**: A Base64-encoded text format for X.509 certificates, wrapped with header/footer lines, preferred by some OPC UA clients and tools.
- **Certificate_File**: The server's public X.509 certificate stored at `./data/certs/server.der`.
- **File_Browse_API**: The REST API endpoint (`POST /api/files/browse`) that opens a server-side file picker and returns the selected path.

## Requirements

### Requirement 1: Download Certificate via REST API (DER)

**User Story:** As an OPC UA integrator, I want to download the server's public certificate in DER format via a REST endpoint, so that I can import it into OPC UA clients for establishing trusted secure connections.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/security/certificate/download`, THE Certificate_Export_API SHALL respond with HTTP 200 and the raw DER-encoded certificate bytes as the response body.
2. WHEN serving the DER certificate, THE Certificate_Export_API SHALL set the `Content-Type` header to `application/x-x509-ca-cert`.
3. WHEN serving the DER certificate, THE Certificate_Export_API SHALL set the `Content-Disposition` header to `attachment; filename="server.der"`.
4. IF no certificate file exists on disk, THEN THE Certificate_Export_API SHALL respond with HTTP 404 and an error body containing code `CERTIFICATE_NOT_FOUND` and a message indicating the certificate has not been generated or configured.
5. IF the certificate file exists but cannot be read due to a filesystem error, THEN THE Certificate_Export_API SHALL respond with HTTP 500 and an error body containing code `INTERNAL_ERROR` and a message indicating the file could not be read.

### Requirement 2: Download Certificate via REST API (PEM)

**User Story:** As an OPC UA integrator, I want to optionally download the server's public certificate in PEM format, so that I can use it with clients and tools that require PEM-encoded certificates.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/security/certificate/download` with query parameter `format=pem` (case-insensitive match), THE Certificate_Export_API SHALL respond with the certificate converted to PEM encoding as defined in Requirement 3.
2. WHEN serving the PEM certificate, THE Certificate_Export_API SHALL set the `Content-Type` header to `application/x-pem-file`.
3. WHEN serving the PEM certificate, THE Certificate_Export_API SHALL set the `Content-Disposition` header to `attachment; filename="server.pem"`.
4. WHEN no `format` query parameter is provided, THE Certificate_Export_API SHALL default to DER format, responding with the same headers and body as defined in Requirement 1 criteria 1–3.
5. IF an invalid `format` query parameter value is provided (not matching `der` or `pem` case-insensitively), THEN THE Certificate_Export_API SHALL respond with HTTP 400 and an error body containing code `VALIDATION_ERROR` and a message listing the valid formats.
6. IF a PEM download is requested and no certificate file exists on disk, THEN THE Certificate_Export_API SHALL respond with HTTP 404 and an error body containing code `CERTIFICATE_NOT_FOUND` and a descriptive message.

### Requirement 3: DER to PEM Conversion

**User Story:** As a developer, I want a reliable conversion function from DER to PEM format, so that the API can serve certificates in either format from the single stored DER file.

#### Acceptance Criteria

1. THE Certificate_Export_API SHALL convert the DER binary buffer to PEM by Base64-encoding the buffer and wrapping it with `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` header and footer lines.
2. WHEN converting to PEM, THE Certificate_Export_API SHALL split the Base64 content into lines of 64 characters each, with LF line endings.
3. THE PEM output SHALL end with a trailing newline character after the `-----END CERTIFICATE-----` footer line.
4. FOR ALL valid DER certificate buffers, converting to PEM and then decoding the PEM back to binary SHALL produce a byte-identical result to the original DER buffer (round-trip property).

### Requirement 4: Download Certificate Button in Web UI

**User Story:** As a server administrator, I want a "Download Certificate" button in the Security Settings page, so that I can quickly obtain the server certificate without using external tools or the command line.

#### Acceptance Criteria

1. WHILE a valid certificate is configured (certificatePath is present and certificateValid is true), THE SecuritySettings_UI SHALL display a "Download Certificate" button in the Certificate Status section.
2. WHEN the "Download Certificate" button is clicked, THE SecuritySettings_UI SHALL initiate a browser file download by sending a GET request to the certificate download endpoint, and the browser SHALL save the file using the filename provided by the server response Content-Disposition header.
3. WHILE no certificate is configured (certificatePath is absent) or the certificate is invalid (certificateValid is false), THE SecuritySettings_UI SHALL hide the "Download Certificate" button.
4. WHILE the download request is pending (between button click and server response), THE SecuritySettings_UI SHALL disable the "Download Certificate" button and display a spinner animation adjacent to the button text.
5. IF the download request fails (network error or non-success HTTP status), THEN THE SecuritySettings_UI SHALL re-enable the "Download Certificate" button, hide the loading indicator, and display an error message indicating the failure reason in the Certificate Status section.
6. WHEN the download completes successfully, THE SecuritySettings_UI SHALL re-enable the "Download Certificate" button and hide the loading indicator.

### Requirement 5: Format Selection in Web UI

**User Story:** As a server administrator, I want to choose between DER and PEM format when downloading the certificate, so that I can get the format my specific OPC UA client requires.

#### Acceptance Criteria

1. THE SecuritySettings_UI SHALL display a format selector with exactly two options (DER and PEM) within the same container as the "Download Certificate" button, with DER pre-selected as the default option.
2. WHEN the user selects PEM format and clicks download, THE SecuritySettings_UI SHALL append `?format=pem` to the download request URL.
3. WHEN the user selects DER format (or leaves the default), THE SecuritySettings_UI SHALL request the download without a format parameter.
4. IF no certificate is currently configured, THEN THE SecuritySettings_UI SHALL disable both the format selector and the "Download Certificate" button.

### Requirement 7: Certificate Remaining Days in Status Bar

**User Story:** As a server administrator, I want to see the certificate remaining days in the application status bar at all times, so that I can quickly assess certificate health without navigating to the Security Settings page.

#### Acceptance Criteria

1. WHEN a certificate is configured and has expiry information, THE StatusBar component SHALL display the certificate remaining days as an integer alongside a label (e.g., "🔒 1825d").
2. WHEN the remaining days are greater than 90, THE StatusBar SHALL display the remaining days value in green text.
3. WHEN the remaining days are between 30 and 90 (inclusive), THE StatusBar SHALL display the remaining days value in yellow/amber text.
4. WHEN the remaining days are less than 30 and greater than 0, THE StatusBar SHALL display the remaining days value in red text.
5. WHEN the remaining days are 0 (certificate expired), THE StatusBar SHALL display "Expired" in red text instead of a number.
6. WHEN no certificate is configured or no expiry data is available, THE StatusBar SHALL not display the certificate days indicator.
7. THE StatusBar SHALL fetch certificate expiry data from the security configuration query (same query used by SecuritySettings) and refresh at the same interval as other status bar data.

### Requirement 8: File Dialog for Certificate Upload

**User Story:** As a server administrator, I want the certificate and private key upload fields to open a file selection dialog when clicked, so that I can browse and select files rather than manually typing file paths.

#### Acceptance Criteria

1. THE SecuritySettings_UI SHALL display a "Browse" button adjacent to the certificate path input field.
2. WHEN the "Browse" button next to the certificate path input is clicked, THE SecuritySettings_UI SHALL open a native file selection dialog filtered to certificate file extensions (.der, .pem, .crt).
3. WHEN the user selects a file in the certificate dialog, THE SecuritySettings_UI SHALL populate the certificate path input field with the selected file's absolute path.
4. THE SecuritySettings_UI SHALL display a "Browse" button adjacent to the private key path input field.
5. WHEN the "Browse" button next to the private key path input is clicked, THE SecuritySettings_UI SHALL open a native file selection dialog filtered to key file extensions (.key, .pem).
6. WHEN the user selects a file in the private key dialog, THE SecuritySettings_UI SHALL populate the private key path input field with the selected file's absolute path.
7. IF the user cancels the file dialog without selecting a file, THEN THE SecuritySettings_UI SHALL leave the corresponding input field unchanged.
8. THE file dialog SHALL support the server-side file picker endpoint (POST /api/files/browse) since this is a web application that cannot use the browser's native file dialog to access server-side paths.

### Requirement 9: Testing Coverage

**User Story:** As a developer, I want comprehensive tests for the certificate export endpoint, status bar indicator, and file dialog functionality, so that regressions are caught automatically.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for the certificate download endpoint covering: DER download success, PEM download success, 404 when no certificate exists, 400 for invalid format, 500 for filesystem errors, and private key protection.
2. THE test suite SHALL include a property-based test verifying the DER-to-PEM round-trip conversion produces byte-identical results for all valid DER certificate buffers.
3. THE test suite SHALL include component tests for the StatusBar certificate remaining days indicator covering: green (>90 days), yellow (30-90 days), red (<30 days), expired (0 days), and hidden (no certificate) states.
4. THE test suite SHALL include component tests for the "Download Certificate" button covering: button visibility, format selection, loading state, success behavior, and error display.
5. THE test suite SHALL include component tests for the file dialog "Browse" buttons covering: dialog trigger on click, path population after selection, and no-change on cancel.

### Requirement 6: Security - Private Key Protection

**User Story:** As a security-conscious administrator, I want to ensure only the public certificate is exportable, so that the private key is never exposed through the download endpoint.

#### Acceptance Criteria

1. WHEN a client requests the certificate download endpoint, THE Certificate_Export_API SHALL respond with the contents of the public certificate file only and SHALL NOT include the private key path or private key file contents in the response body or headers.
2. IF a request attempts to access the private key file via the download endpoint by including path traversal sequences (../, ..\) or referencing key file extensions, THEN THE Certificate_Export_API SHALL reject the request and respond with HTTP 403 and an error response indicating access is denied.
3. THE Certificate_Export_API SHALL read only the certificate file path stored in the security configuration table and SHALL NOT accept user-supplied file paths as request parameters or request body input for determining which file to serve.
4. IF no certificate path is configured in the security configuration, THEN THE Certificate_Export_API SHALL respond with HTTP 404 and an error response indicating no certificate is available for download.
5. IF the configured certificate file does not exist on disk, THEN THE Certificate_Export_API SHALL respond with HTTP 404 and an error response indicating the certificate file was not found.

# Requirements Document

## Introduction

In-app self-signed certificate generation for OPC UA security. This feature enables the OPC UA Light Server to generate 2048-bit RSA self-signed certificates using the node-forge library, with automatic IP detection for Subject Alternative Names, configurable DNS/IP overrides, and automatic security configuration updates. The Web UI provides a "Generate Certificate" button with SAN inputs and displays certificate remaining days prominently.

## Glossary

- **Cert_Generator**: The core module (`src/cert-generator/index.ts`) responsible for generating self-signed X.509 certificates and reading certificate expiry information using node-forge.
- **Security_API**: The Express route handler at `POST /api/security/generate` that validates input, orchestrates certificate generation, and auto-applies the result to the security configuration.
- **Security_Repository**: The data access layer (`src/db/repositories/security-repository.ts`) that persists certificate and key paths in the `security_config` SQLite table.
- **Security_Settings_UI**: The React component (`web/src/components/SecuritySettings.tsx`) that displays certificate status, remaining days, and provides the certificate generation form.
- **SAN**: Subject Alternative Name — X.509 extension listing DNS names and IP addresses for which the certificate is valid.
- **Application_URI**: A URN identifier embedded in the certificate (e.g., `urn:opcua-light-server:application`) used by OPC UA for endpoint identification.
- **DER**: Distinguished Encoding Rules — a binary certificate format used for storage at `./data/certs/server.der`.
- **Force_Flag**: A boolean parameter (`force=true`) required in the generation request to confirm overwriting existing certificate files.

## Requirements

### Requirement 1: Generate RSA Key Pair

**User Story:** As a server administrator, I want the system to generate a 2048-bit RSA key pair, so that the OPC UA server has cryptographic material for secure communication.

#### Acceptance Criteria

1. WHEN a certificate generation request is received, THE Cert_Generator SHALL generate a 2048-bit RSA key pair using node-forge.
2. THE Cert_Generator SHALL store the private key in PEM format at the path `./data/certs/server.key`.
3. THE Cert_Generator SHALL store the certificate in DER format at the path `./data/certs/server.der`.
4. WHEN the output directory `./data/certs/` does not exist, THE Cert_Generator SHALL create the directory recursively before writing files.
5. IF directory creation or file writing fails due to a filesystem error, THEN THE Cert_Generator SHALL throw an error indicating the failed operation and the target path, without leaving partial files (if the key was written but the certificate write fails, the key file SHALL be removed).
6. WHEN writing the private key file, THE Cert_Generator SHALL set file permissions to owner-read-only (0o400 on POSIX systems) to restrict access to the key material.
7. WHEN both files are written successfully, THE Cert_Generator SHALL write the private key file before the certificate file to ensure the key is available when the certificate is later consumed by the runtime.

### Requirement 2: Create Self-Signed X.509 Certificate

**User Story:** As a server administrator, I want the generated certificate to be a valid self-signed X.509v3 certificate with appropriate attributes, so that OPC UA clients can establish secure connections.

#### Acceptance Criteria

1. THE Cert_Generator SHALL create a self-signed X.509 version 3 certificate with a validity period of 1825 days (5 years) from the generation timestamp.
2. THE Cert_Generator SHALL set the certificate serial number to a random positive integer of at least 8 bytes and at most 20 bytes in length.
3. THE Cert_Generator SHALL set the issuer and subject to identical distinguished name fields (self-signed).
4. WHEN a commonName is provided in the request, THE Cert_Generator SHALL use the provided value (maximum 64 characters) as the subject Common Name.
5. WHEN no commonName is provided or the provided value is an empty string after trimming, THE Cert_Generator SHALL use "OPC UA Light Server" as the default Common Name.
6. WHEN an organization is provided in the request, THE Cert_Generator SHALL include the value (maximum 64 characters) in the subject Organization field.
7. IF no organization is provided in the request, THEN THE Cert_Generator SHALL omit the Organization field from the subject distinguished name.
8. WHEN a country code is provided in the request, THE Cert_Generator SHALL include the two-letter value in the subject Country field.
9. IF no country code is provided in the request, THEN THE Cert_Generator SHALL omit the Country field from the subject distinguished name.

### Requirement 3: Configure Subject Alternative Names

**User Story:** As a server administrator, I want to control which DNS names and IP addresses appear in the certificate SAN extension, so that the certificate is valid for all network interfaces used in the industrial environment.

#### Acceptance Criteria

1. THE Cert_Generator SHALL include a Subject Alternative Name extension in the generated certificate containing at minimum the Application_URI entry and the `127.0.0.1` IP entry.
2. WHEN ipAddresses are provided in the request as a non-empty array, THE Cert_Generator SHALL use only the provided IP addresses (plus `127.0.0.1`) as SAN IP entries, skipping auto-detection.
3. WHEN no ipAddresses are provided or the array is empty, THE Cert_Generator SHALL auto-detect local non-loopback IPv4 addresses from network interfaces and include them as SAN IP entries.
4. THE Cert_Generator SHALL always include `127.0.0.1` in the SAN IP entries regardless of whether IP addresses were auto-detected or manually provided.
5. WHEN dnsNames are provided in the request as a non-empty array, THE Cert_Generator SHALL include each provided DNS name as a SAN DNS entry.
6. THE Cert_Generator SHALL include the Application_URI (`urn:opcua-light-server:application`) as a SAN URI entry.
7. IF an ipAddresses entry is not a valid IPv4 address (four octets 0-255 separated by dots), THEN THE Cert_Generator SHALL reject the request with a validation error indicating the invalid entry.
8. IF a dnsNames entry is an empty string or exceeds 253 characters, THEN THE Cert_Generator SHALL reject the request with a validation error indicating the invalid entry.

### Requirement 4: Overwrite Protection with Force Flag

**User Story:** As a server administrator, I want the system to require explicit confirmation before overwriting existing certificates, so that accidental regeneration is prevented.

#### Acceptance Criteria

1. IF a certificate file already exists at `./data/certs/server.der` and the request body does not include `force` set to boolean `true`, THEN THE Security_API SHALL return a 400 error with code `VALIDATION_ERROR` and a message indicating the certificate already exists.
2. WHEN a generate-certificate request is received with `force` set to boolean `true`, THE Security_API SHALL overwrite existing certificate and key files and return a 201 response containing the updated security configuration.
3. WHEN a generate-certificate request is received and no certificate file exists at `./data/certs/server.der`, THE Security_API SHALL proceed with generation regardless of the `force` flag value and return a 201 response containing the updated security configuration.
4. IF the `force` field is provided with a non-boolean value, THEN THE Security_API SHALL treat it as not set and apply the existence check for overwrite protection.

### Requirement 5: Auto-Apply Security Configuration

**User Story:** As a server administrator, I want the system to automatically update the security configuration after generating a certificate, so that no manual configuration step is needed.

#### Acceptance Criteria

1. WHEN certificate generation completes successfully, THE Security_API SHALL update the `security_config` table with the new certificate path (`./data/certs/server.der`).
2. WHEN certificate generation completes successfully, THE Security_API SHALL update the `security_config` table with the new private key path (`./data/certs/server.key`).
3. WHEN certificate generation completes successfully, THE Security_API SHALL return the updated SecurityConfig object including the certificate expiry date as an ISO 8601 string (`certificateExpiresAt`) and the remaining days until expiry as an integer (`certificateRemainingDays`).
4. WHEN certificate generation completes successfully, THE Security_API SHALL return HTTP status 201.
5. IF a certificate already exists at the target path and the request body does not include `force` set to `true`, THEN THE Security_API SHALL reject the request with an error response indicating that the certificate already exists and that `force` must be set to `true` to overwrite.
6. IF certificate generation fails due to a filesystem or internal error, THEN THE Security_API SHALL return an error response indicating the failure reason and SHALL NOT modify the existing `security_config` table values.

### Requirement 6: Read Certificate Expiry Information

**User Story:** As a server administrator, I want to see when my certificate expires and how many days remain, so that I can plan certificate renewal.

#### Acceptance Criteria

1. WHEN a valid DER certificate file exists at the configured path, THE Cert_Generator SHALL parse the certificate and return the expiry date as an ISO 8601 string with full timestamp precision (e.g., `2031-06-09T12:00:00.000Z`).
2. WHEN a valid DER certificate file exists at the configured path, THE Cert_Generator SHALL calculate and return the remaining days until expiry as a non-negative integer (floor of the remaining milliseconds divided by 86,400,000).
3. IF the certificate file does not exist or cannot be parsed, THEN THE Cert_Generator SHALL return `null` without throwing an error.
4. THE Security_Repository SHALL include `certificateExpiresAt` and `certificateRemainingDays` fields in the SecurityConfig response when a certificate is configured and readable.
5. IF the certificate has already expired, THEN THE Cert_Generator SHALL return `remainingDays` as 0.

### Requirement 7: Web UI Certificate Generation Form

**User Story:** As a server administrator, I want a "Generate Certificate" button with optional SAN inputs in the security settings page, so that I can generate certificates without using the API directly.

#### Acceptance Criteria

1. THE Security_Settings_UI SHALL display a "Generate Certificate" button in the security settings page.
2. THE Security_Settings_UI SHALL provide an optional input field for custom DNS names, accepting comma-separated or multi-line values, with each entry limited to 253 characters and a maximum of 20 entries.
3. THE Security_Settings_UI SHALL provide an optional input field for custom IP addresses (IPv4 or IPv6), accepting comma-separated or multi-line values, with a maximum of 20 entries.
4. WHEN the user clicks "Generate Certificate" and no DNS names or IP addresses are provided, THE Security_Settings_UI SHALL send the generation request without SAN parameters, allowing the API to apply its defaults.
5. WHEN the user clicks "Generate Certificate" and a certificate already exists, THE Security_Settings_UI SHALL display a confirmation dialog before sending the request with `force=true`.
6. WHILE a certificate generation request is pending, THE Security_Settings_UI SHALL disable the "Generate Certificate" button and display a loading indicator.
7. WHEN certificate generation succeeds, THE Security_Settings_UI SHALL invalidate the security configuration query cache to refresh the certificate status display and show a success notification.
8. IF certificate generation fails, THEN THE Security_Settings_UI SHALL display the error message returned by the API.
9. IF the user provides a DNS name or IP address that does not match a valid format, THEN THE Security_Settings_UI SHALL display a validation error indicating the invalid entry and prevent form submission.

### Requirement 8: Certificate Remaining Days Display

**User Story:** As a server administrator, I want to see the certificate remaining days prominently in the security settings page, so that I can quickly assess certificate health.

#### Acceptance Criteria

1. WHEN a certificate is configured and has expiry information, THE Security_Settings_UI SHALL display the remaining days until expiry as an integer value with a dedicated label positioned in the upper section of the security settings page.
2. WHEN the remaining days are greater than 90, THE Security_Settings_UI SHALL display the value with a green visual indicator.
3. WHEN the remaining days are between 30 and 90 (inclusive), THE Security_Settings_UI SHALL display the value with a yellow/warning visual indicator.
4. WHEN the remaining days are less than 30 and greater than 0, THE Security_Settings_UI SHALL display the value with a red/critical visual indicator.
5. WHEN a certificate is configured and has expiry information, THE Security_Settings_UI SHALL display the certificate expiry date in ISO 8601 format (YYYY-MM-DD) alongside the remaining days count.
6. IF the remaining days are 0 or negative (certificate expired), THEN THE Security_Settings_UI SHALL display the value as "Expired" with a red/critical visual indicator.
7. IF no certificate is configured or the certificate has no expiry information, THEN THE Security_Settings_UI SHALL display a message indicating that no certificate expiry data is available, without showing any color-coded indicator.

### Requirement 9: Input Validation

**User Story:** As a server administrator, I want the system to validate all inputs to the certificate generation endpoint, so that malformed requests produce clear error messages.

#### Acceptance Criteria

1. WHEN a provided IP address does not match a valid IPv4 dotted-decimal format (e.g., "192.168.1.1") or a valid IPv6 colon-hexadecimal format (e.g., "::1"), THE Security_API SHALL return a 400 error with a detail indicating the invalid ipAddresses field.
2. WHEN a provided country code is not exactly two uppercase ASCII letters (A-Z), THE Security_API SHALL return a 400 error with a detail indicating the invalid country field.
3. WHEN a provided DNS name contains characters outside the set of ASCII letters (a-z, A-Z), digits (0-9), hyphens (-), and dots (.), or exceeds 253 characters in total length, THE Security_API SHALL return a 400 error with a detail indicating the invalid dnsNames field.
4. THE Security_API SHALL trim leading and trailing whitespace from the commonName, organization, country, and each entry in the dnsNames and ipAddresses arrays before performing validation or processing.
5. IF multiple input fields fail validation in a single request, THEN THE Security_API SHALL return a single 400 error response whose details array contains one entry per invalid field.

### Requirement 10: HTTPS for Backend-Frontend Communication

**User Story:** As a server administrator, I want the Control API to serve over HTTPS using the generated certificate, so that communication between the Web UI and the backend is encrypted and consistent with the OPC UA security posture.

#### Acceptance Criteria

1. WHEN a valid certificate and private key are configured in `security_config` and the security mode is `Sign` or `SignAndEncrypt`, THE Control API SHALL start an HTTPS server using the configured certificate and private key files.
2. WHEN the security mode is `None` or no certificate is configured, THE Control API SHALL start an HTTP-only server (current behavior).
3. THE Control API SHALL expose the HTTPS port via the `PORT` environment variable (default 3100), replacing the HTTP listener when HTTPS is active.
4. WHEN HTTPS is active, THE Control API SHALL redirect HTTP requests on the same port to HTTPS, OR reject plain HTTP connections with an appropriate error.
5. THE Web UI Vite dev server proxy SHALL support proxying to both `http://localhost:3100` and `https://localhost:3100` depending on the backend configuration.
6. WHEN HTTPS is active with a self-signed certificate, THE Web UI API client SHALL accept the self-signed certificate without validation errors in production (same-origin requests via browser).
7. IF the configured certificate or private key file cannot be read at startup, THEN THE Control API SHALL fall back to HTTP-only mode and log a warning indicating the reason.
8. WHEN a new certificate is generated via `POST /api/security/generate`, THE Control API SHALL NOT automatically restart in HTTPS mode; a manual server restart is required to apply the new transport configuration.

### Requirement 11: Certificate Generation Correctness (Property-Based)

**User Story:** As a developer, I want property-based tests to verify certificate generation correctness across randomized inputs, so that edge cases are discovered automatically.

#### Acceptance Criteria

1. FOR ALL valid GenerateCertificateRequest inputs (commonName 1-64 chars, organization 1-64 chars, country exactly 2 uppercase letters, dnsNames matching hostname regex, ipAddresses matching IPv4 format), THE Cert_Generator SHALL produce a certificate where the subject and issuer distinguished names are identical (self-signed property).
2. FOR ALL generated certificates, THE Cert_Generator SHALL produce a certificate with a validity period of exactly 1825 days from the not-before date to the not-after date (measured as the difference in milliseconds divided by 86,400,000, rounded to nearest integer).
3. FOR ALL generated certificates, THE Cert_Generator SHALL produce a certificate whose public key modulus matches the generated private key modulus (key-pair consistency property).
4. FOR ALL valid IP addresses provided in the ipAddresses array, THE Cert_Generator SHALL include each IP address in the certificate SAN extension IP entries, plus `127.0.0.1` (SAN completeness property).
5. FOR ALL generated certificates, calling `readCertificateExpiry` on the output DER file SHALL return a non-null result with `remainingDays` between 1824 and 1825 inclusive (freshly generated certificate expiry property).

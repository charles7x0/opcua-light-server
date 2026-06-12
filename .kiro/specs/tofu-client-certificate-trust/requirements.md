# Requirements Document

## Introduction

Trust On First Use (TOFU) client certificate management for the OPC UA Light Server. Currently the server uses `UA_CertificateVerification_AcceptAll`, which blindly trusts any client certificate. This feature replaces that with a TOFU model: the first time an unknown client connects, its certificate is automatically trusted and persisted. Subsequent connections are verified against the stored trust store. Operators can review, reject, or re-trust certificates via the Control API and Web UI.

## Glossary

- **TOFU_Manager**: The Node.js service responsible for managing the PKI directory structure, persisting client certificates, and exposing trust/reject operations via the API.
- **Runtime_Verifier**: The custom certificate verification callback in the open62541 C runtime that checks incoming client certificates against the on-disk trust store.
- **Trust_Store**: The directory `data/pki/trusted/` containing DER-encoded client certificates that are accepted for connections.
- **Reject_Store**: The directory `data/pki/rejected/` containing DER-encoded client certificates that are explicitly denied.
- **Client_Certificate**: A DER-encoded X.509 certificate presented by an OPC UA client during the secure channel handshake.
- **Certificate_Thumbprint**: The SHA-1 hash of the DER-encoded certificate, used as a unique identifier and filename.
- **PKI_Directory**: The parent directory `data/pki/` containing subdirectories for trusted and rejected certificates.
- **Control_API**: The Node.js/Express HTTP server that exposes REST endpoints for managing the OPC UA server.
- **Web_UI**: The React browser dashboard for operator administration.

## Requirements

### Requirement 1: PKI Directory Initialization

**User Story:** As an operator, I want the server to automatically create the PKI directory structure on startup, so that I do not need to manually create folders before using certificate trust management.

#### Acceptance Criteria

1. WHEN the Control_API starts, THE TOFU_Manager SHALL create the PKI_Directory at `data/pki/` if it does not exist, including any intermediate parent directories.
2. WHEN the Control_API starts, THE TOFU_Manager SHALL create the Trust_Store directory at `data/pki/trusted/` if it does not exist.
3. WHEN the Control_API starts, THE TOFU_Manager SHALL create the Reject_Store directory at `data/pki/rejected/` if it does not exist.
4. WHEN the PKI_Directory structure already exists, THE TOFU_Manager SHALL leave existing directories and their contents unchanged.
5. THE TOFU_Manager SHALL complete PKI_Directory initialization before the OPC UA runtime is started.
6. IF the PKI_Directory creation fails due to a filesystem error, THEN THE TOFU_Manager SHALL log an error message indicating the failure reason, and THE Control_API SHALL continue running but prevent the OPC UA runtime from starting until the directory issue is resolved.

### Requirement 2: Trust On First Use Acceptance

**User Story:** As an operator, I want unknown client certificates to be automatically trusted on first connection, so that new clients can connect without manual pre-configuration.

#### Acceptance Criteria

1. WHEN an OPC UA client presents a Client_Certificate that is not in the Trust_Store and not in the Reject_Store, THE Runtime_Verifier SHALL accept the connection and save the certificate to the Trust_Store.
2. WHEN a Client_Certificate is saved to the Trust_Store, THE Runtime_Verifier SHALL use the Certificate_Thumbprint encoded as a 40-character lowercase hexadecimal string as the filename with a `.der` extension.
3. WHEN a Client_Certificate is saved to the Trust_Store, THE TOFU_Manager SHALL log the event including the Certificate_Thumbprint and the client application URI.
4. IF saving the Client_Certificate to the Trust_Store fails due to a filesystem error, THEN THE Runtime_Verifier SHALL still accept the connection and log an error indicating the Certificate_Thumbprint and the failure reason.

### Requirement 3: Trusted Certificate Verification

**User Story:** As an operator, I want subsequent connections from previously-seen clients to be verified against the trust store, so that only known clients can connect.

#### Acceptance Criteria

1. WHEN an OPC UA client presents a Client_Certificate whose Certificate_Thumbprint matches a file in the Trust_Store, THE Runtime_Verifier SHALL accept the connection by returning `UA_STATUSCODE_GOOD`.
2. WHEN an OPC UA client presents a Client_Certificate whose Certificate_Thumbprint matches a file in the Reject_Store, THE Runtime_Verifier SHALL reject the connection by returning `UA_STATUSCODE_BADCERTIFICATEUNTRUSTED`.
3. IF a Client_Certificate's Certificate_Thumbprint exists in both the Trust_Store and the Reject_Store simultaneously, THEN THE Runtime_Verifier SHALL treat the certificate as rejected and return `UA_STATUSCODE_BADCERTIFICATEUNTRUSTED`.
4. IF the Trust_Store or Reject_Store directory is unreadable during certificate verification, THEN THE Runtime_Verifier SHALL reject the connection by returning `UA_STATUSCODE_BADCERTIFICATEUNTRUSTED`.

### Requirement 4: Certificate Rejection

**User Story:** As an operator, I want to reject a previously trusted certificate, so that I can revoke access for compromised or unauthorized clients.

#### Acceptance Criteria

1. WHEN an operator issues a reject request for a certificate identified by its Certificate_Thumbprint, THE TOFU_Manager SHALL move the certificate file from the Trust_Store to the Reject_Store and return a success response containing the Certificate_Thumbprint and the new status "rejected".
2. IF the specified Certificate_Thumbprint does not exist in the Trust_Store, THEN THE TOFU_Manager SHALL return a 404 error response with a message indicating that the certificate was not found in the Trust_Store.
3. WHEN a certificate is moved to the Reject_Store, THE TOFU_Manager SHALL log the rejection event with the Certificate_Thumbprint.
4. IF the Certificate_Thumbprint in the request is not a valid 40-character lowercase hexadecimal string, THEN THE TOFU_Manager SHALL return a 400 error response with a message indicating the invalid thumbprint format.
5. IF the filesystem operation to move the certificate fails, THEN THE TOFU_Manager SHALL return a 500 error response with a message indicating the move failure, and SHALL NOT remove the certificate from the Trust_Store.

### Requirement 5: Certificate Re-Trust

**User Story:** As an operator, I want to re-trust a previously rejected certificate, so that I can restore access for clients that were mistakenly rejected.

#### Acceptance Criteria

1. WHEN an operator issues a trust request for a certificate identified by its Certificate_Thumbprint, THE TOFU_Manager SHALL move the certificate file from the Reject_Store to the Trust_Store.
2. IF the specified Certificate_Thumbprint does not exist in the Reject_Store, THEN THE TOFU_Manager SHALL return a 404 error response indicating the certificate was not found in the Reject_Store.
3. IF the certificate file move from the Reject_Store to the Trust_Store fails due to a filesystem error, THEN THE TOFU_Manager SHALL return an error response indicating the operation failed and SHALL leave the certificate in its original location in the Reject_Store.
4. WHEN a certificate is moved to the Trust_Store, THE TOFU_Manager SHALL log the re-trust event with the Certificate_Thumbprint.
5. IF the specified Certificate_Thumbprint already exists in the Trust_Store, THEN THE TOFU_Manager SHALL return a 409 conflict error response indicating the certificate is already trusted.

### Requirement 6: Certificate Listing API

**User Story:** As an operator, I want to list all trusted and rejected client certificates, so that I can review which clients have connected and their trust status.

#### Acceptance Criteria

1. WHEN an operator requests the list of certificates, THE TOFU_Manager SHALL return all certificates from both the Trust_Store and the Reject_Store, sorted alphabetically by Certificate_Thumbprint in ascending order.
2. THE TOFU_Manager SHALL include for each certificate: the Certificate_Thumbprint, the trust status (trusted or rejected), the subject common name, the issuer common name, the validity period (notBefore and notAfter dates in ISO 8601 format), and the certificate file size in bytes.
3. IF the PKI_Directory contains no certificates, THEN THE TOFU_Manager SHALL return an empty list with no error indication.
4. IF a certificate file in the Trust_Store or Reject_Store is malformed or cannot be parsed, THEN THE TOFU_Manager SHALL omit that entry from the returned list and continue processing the remaining certificates.
5. WHEN an operator requests the list of certificates, THE TOFU_Manager SHALL return the response within 2 seconds for up to 1000 certificates.

### Requirement 7: Certificate Deletion

**User Story:** As an operator, I want to permanently delete a client certificate from both stores, so that the client will be treated as new on next connection (re-triggering TOFU).

#### Acceptance Criteria

1. WHEN an operator issues a delete request for a certificate identified by its Certificate_Thumbprint, THE TOFU_Manager SHALL remove the certificate file from whichever store it resides in.
2. IF the specified Certificate_Thumbprint does not exist in either store, THEN THE TOFU_Manager SHALL return a 404 error response.
3. WHEN a certificate is deleted, THE TOFU_Manager SHALL log the deletion event with the Certificate_Thumbprint.
4. IF the Certificate_Thumbprint in the request is not a valid 40-character lowercase hexadecimal string, THEN THE TOFU_Manager SHALL return a 400 error response with a message indicating the invalid thumbprint format.
5. IF the filesystem operation to delete the certificate fails, THEN THE TOFU_Manager SHALL return a 500 error response with a message indicating the deletion failure.

### Requirement 8: REST API Endpoints

**User Story:** As a developer, I want REST API endpoints for certificate trust management, so that I can integrate with the Control API and automate trust operations.

#### Acceptance Criteria

1. THE Control_API SHALL expose a `GET /api/pki/certificates` endpoint that returns a JSON array of certificate objects, each containing the fields defined in Requirement 6 criterion 2.
2. THE Control_API SHALL expose a `POST /api/pki/certificates/:thumbprint/reject` endpoint that moves a certificate to the Reject_Store and returns a success response with no body.
3. THE Control_API SHALL expose a `POST /api/pki/certificates/:thumbprint/trust` endpoint that moves a certificate to the Trust_Store and returns a success response with no body.
4. THE Control_API SHALL expose a `DELETE /api/pki/certificates/:thumbprint` endpoint that permanently removes a certificate and returns a success response with no body.
5. THE Control_API SHALL require authentication on all PKI endpoints that perform mutations (POST and DELETE operations).
6. THE Control_API SHALL expose the `GET /api/pki/certificates` endpoint without authentication for monitoring purposes.
7. IF a POST or DELETE PKI request is received without valid authentication credentials, THEN THE Control_API SHALL return a 401 response with an error message indicating the authentication failure reason.
8. IF the `:thumbprint` path parameter is not a valid 40-character lowercase hexadecimal string, THEN THE Control_API SHALL return a 400 response with an error message indicating the invalid thumbprint format.

### Requirement 9: Runtime Trust Store Reload

**User Story:** As an operator, I want the runtime to re-read the trust store after trust changes, so that rejected certificates are immediately denied without restarting the server.

#### Acceptance Criteria

1. WHEN a certificate trust operation completes (reject, trust, or delete), THE TOFU_Manager SHALL send a reload command to the Runtime_Verifier via the existing stdin IPC channel.
2. WHEN the Runtime_Verifier receives a reload command, THE Runtime_Verifier SHALL re-read all certificate files from the Trust_Store and Reject_Store directories within 1 second.
3. WHILE the Runtime_Verifier is reloading the trust store, THE Runtime_Verifier SHALL continue verifying connections using the previous trust state until the new state has been fully loaded from both directories.
4. IF the Runtime_Verifier fails to re-read one or more certificate files during reload, THEN THE Runtime_Verifier SHALL retain the previous trust state, log the error, and report the failure to the TOFU_Manager via the existing IPC mechanism.
5. IF the OPC UA runtime is not running when a trust operation completes, THEN THE TOFU_Manager SHALL skip the reload signal and log that the reload was deferred until next runtime start.

### Requirement 10: Custom Certificate Verification Callback

**User Story:** As a developer, I want a custom certificate verification callback in the C runtime, so that TOFU logic replaces the current AcceptAll behavior.

#### Acceptance Criteria

1. WHEN the C runtime configures security with mode "Sign" or "SignAndEncrypt", THE Runtime_Verifier SHALL register a custom certificate verification callback in place of `UA_CertificateVerification_AcceptAll`.
2. WHEN the custom callback receives a Client_Certificate, THE Runtime_Verifier SHALL compute its Certificate_Thumbprint as the SHA-1 hash of the raw DER-encoded certificate bytes, represented as a 40-character lowercase hexadecimal string.
3. WHEN the computed thumbprint matches the filename (excluding file extension) of any file in the Reject_Store directory, THE Runtime_Verifier SHALL return `UA_STATUSCODE_BADCERTIFICATEUNTRUSTED`.
4. WHEN the computed thumbprint matches the filename (excluding file extension) of any file in the Trust_Store directory, THE Runtime_Verifier SHALL return `UA_STATUSCODE_GOOD`.
5. WHEN the computed thumbprint matches no filename in either the Trust_Store or Reject_Store directories, THE Runtime_Verifier SHALL save the DER-encoded certificate to the Trust_Store directory with the filename `<thumbprint>.der` and return `UA_STATUSCODE_GOOD`.
6. IF the Runtime_Verifier fails to save the certificate to the Trust_Store due to a file I/O error, THEN THE Runtime_Verifier SHALL log the error to stderr and return `UA_STATUSCODE_GOOD` to allow the connection.
7. THE Runtime_Verifier SHALL resolve the Trust_Store and Reject_Store directory paths from the `pkiTrustedPath` and `pkiRejectedPath` fields in the security section of the JSON configuration file.

### Requirement 11: Configuration Integration

**User Story:** As a developer, I want the PKI paths to be passed to the runtime via the JSON configuration, so that the runtime knows where to find and store certificates.

#### Acceptance Criteria

1. WHEN security mode is "Sign" or "SignAndEncrypt", THE config-generator SHALL include `pkiTrustedPath` and `pkiRejectedPath` string fields in the security section of the runtime configuration JSON, each containing the absolute filesystem path to the respective directory.
2. WHEN security mode is "None", THE config-generator SHALL omit the `pkiTrustedPath` and `pkiRejectedPath` fields from the security section of the configuration JSON.
3. WHEN the runtime starts and the security section contains `pkiTrustedPath` and `pkiRejectedPath` fields, THE runtime SHALL read and apply both values from the configuration JSON before configuring security policies.
4. IF security mode is "Sign" or "SignAndEncrypt" and either `pkiTrustedPath` or `pkiRejectedPath` is missing from the security section, THEN THE config-generator SHALL fall back to security mode "None" and log a warning message indicating which field is missing.

### Requirement 12: Web UI Certificate Management

**User Story:** As an operator, I want a certificate management panel in the web dashboard, so that I can visually review and manage client certificate trust.

#### Acceptance Criteria

1. THE Web_UI SHALL display a certificate management panel as a section within the security settings page.
2. THE Web_UI SHALL display a table of all client certificates with columns for: thumbprint (first 16 hexadecimal characters), subject, status (trusted/rejected), and expiry date (YYYY-MM-DD format).
3. IF no client certificates exist, THEN THE Web_UI SHALL display an empty-state message indicating that no client certificates have been received.
4. WHEN an operator clicks the reject button for a trusted certificate, THE Web_UI SHALL call the reject endpoint and refresh the certificate list upon success.
5. WHEN an operator clicks the trust button for a rejected certificate, THE Web_UI SHALL call the trust endpoint and refresh the certificate list upon success.
6. WHEN an operator clicks the delete button for a certificate, THE Web_UI SHALL display a confirmation dialog with cancel and confirm options before calling the delete endpoint.
7. WHEN the operator confirms deletion in the confirmation dialog, THE Web_UI SHALL call the delete endpoint and refresh the certificate list upon success.
8. IF a trust, reject, or delete API call fails, THEN THE Web_UI SHALL display an inline error message indicating the failure reason and preserve the current list state without modification.

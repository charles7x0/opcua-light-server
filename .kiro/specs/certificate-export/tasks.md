# Implementation Plan: Certificate Export

## Overview

This plan implements certificate export capabilities for the OPC UA Light Server. It adds a REST API endpoint for downloading the server's public certificate in DER or PEM format, a DER-to-PEM conversion utility, a file browse API for server-side file selection, frontend download controls with format selection, a certificate health indicator in the status bar, and browse buttons for the certificate upload form.

## Tasks

- [x] 1. Implement DER-to-PEM conversion utility
  - [x] 1.1 Create `src/cert-generator/cert-utils.ts` with `derToPem` and `pemToDer` functions
    - Implement `derToPem(derBuffer: Buffer): string` — Base64-encode buffer, split into 64-char lines with LF endings, wrap with BEGIN/END CERTIFICATE markers, trailing newline after footer
    - Implement `pemToDer(pemString: string): Buffer` — Strip header/footer, join Base64 lines, decode to Buffer
    - Pure functions with no side effects
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Write property test: DER-to-PEM round trip (Property 1)
    - **Property 1: DER-to-PEM Round Trip**
    - For any valid byte buffer, `pemToDer(derToPem(buffer))` produces byte-identical result to original
    - Use fast-check with arbitrary `Uint8Array` generation, minimum 100 iterations
    - File: `tests/property/cert-export.test.ts`
    - **Validates: Requirements 3.4**

  - [x] 1.3 Write property test: PEM format structural invariant (Property 2)
    - **Property 2: PEM Format Structural Invariant**
    - For any valid byte buffer, `derToPem(buffer)` begins with `-----BEGIN CERTIFICATE-----\n`, ends with `-----END CERTIFICATE-----\n`, contains only Base64 chars and newlines between markers, all lines exactly 64 chars except possibly the last (1–64 chars)
    - File: `tests/property/cert-export.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 1.4 Write unit tests for cert-utils
    - Test `derToPem` produces valid PEM structure with known input
    - Test PEM lines are 64 chars max
    - Test PEM ends with trailing newline
    - Test `pemToDer` reverses `derToPem` with specific certificate examples
    - File: `tests/unit/cert-utils.test.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. Implement certificate download route handler
  - [x] 2.1 Add `getCertificatePath(): string | null` method to `src/db/repositories/security-repository.ts`
    - Query `security_config` table for `certificate_path` column only
    - Return null if no path configured
    - Do NOT expose private key path
    - _Requirements: 6.1, 6.3_

  - [x] 2.2 Add `GET /api/security/certificate/download` route to `src/api/routes/security.ts`
    - Validate `format` query parameter (accept `der`, `pem` case-insensitive; default to `der`)
    - Return 400 with `VALIDATION_ERROR` for invalid format values
    - Retrieve certificate path from `SecurityRepository.getCertificatePath()`
    - Return 404 with `CERTIFICATE_NOT_FOUND` if no path configured or file missing
    - Reject path traversal sequences (`../`, `..\`, `%2e%2e/`, `%2e%2e\`) with 403 `ACCESS_DENIED`
    - Read certificate file with `readFileSync`
    - For DER: set `Content-Type: application/x-x509-ca-cert`, `Content-Disposition: attachment; filename="server.der"`
    - For PEM: convert using `derToPem()`, set `Content-Type: application/x-pem-file`, `Content-Disposition: attachment; filename="server.pem"`
    - Return 500 with `INTERNAL_ERROR` on filesystem read errors
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 2.3 Write unit tests for certificate download endpoint
    - Test DER download returns 200 with correct Content-Type and Content-Disposition
    - Test PEM download returns 200 with PEM Content-Type and correct filename
    - Test default format (no param) returns DER
    - Test format parameter is case-insensitive
    - Test invalid format returns 400 VALIDATION_ERROR
    - Test no certificate configured returns 404
    - Test certificate file missing from disk returns 404
    - Test filesystem read error returns 500
    - Test response never contains private key markers
    - Test path traversal in query params returns 403
    - Test endpoint reads from repo, not request params
    - File: `tests/unit/certificate-download.test.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 2.4 Write property test: Private key non-exposure (Property 4)
    - **Property 4: Private Key Non-Exposure**
    - For any valid request to the download endpoint, response body and headers never contain PEM private key markers (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`)
    - File: `tests/property/cert-export.test.ts`
    - **Validates: Requirements 6.1**

  - [x] 2.5 Write property test: Path traversal rejection (Property 5)
    - **Property 5: Path Traversal Rejection**
    - For any request containing path traversal sequences in query parameters, headers, or URL path segments, the endpoint responds with HTTP 403
    - File: `tests/property/cert-export.test.ts`
    - **Validates: Requirements 6.2**

- [x] 3. Checkpoint - Backend API complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement file browse route handler
  - [x] 4.1 Create `src/api/routes/files.ts` with `POST /api/files/browse` route
    - Accept request body with optional `startPath` (defaults to cwd) and `extensions` array (e.g., `[".der", ".pem", ".crt"]`)
    - Return directory listing filtered by extensions
    - Validate `startPath` — return 400 for invalid paths
    - Reject path traversal attempts with 403 `ACCESS_DENIED`
    - Return `{ selectedPath: string | null }` response
    - Register the new route in the Express app
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.8_

  - [x] 4.2 Write unit tests for file browse endpoint
    - Test valid directory returns filtered file list
    - Test extension filtering works correctly
    - Test invalid start path returns 400
    - Test path traversal returns 403
    - Test default start path when none provided
    - File: `tests/unit/file-browse.test.ts`
    - _Requirements: 8.2, 8.5, 8.8_

- [x] 5. Implement frontend API client extensions
  - [x] 5.1 Add `getCertificateDownloadUrl` and `browseFiles` functions to `web/src/api.ts`
    - `getCertificateDownloadUrl(format?: 'der' | 'pem'): string` — Returns the download URL, appends `?format=pem` when PEM selected
    - `browseFiles(options?: { startPath?: string; extensions?: string[] }): Promise<{ selectedPath: string | null }>` — POST to `/api/files/browse`
    - _Requirements: 4.2, 5.2, 5.3, 8.2, 8.5_

- [x] 6. Implement certificate download UI in SecuritySettings
  - [x] 6.1 Add format selector and "Download Certificate" button to `web/src/components/SecuritySettings.tsx`
    - Add `<select>` with DER and PEM options, DER pre-selected as default
    - Add "Download Certificate" button visible only when `certificatePath` is present and `certificateValid` is true
    - Hide button and disable selector when no certificate configured
    - Implement download via temporary `<a>` element with download URL
    - Show loading spinner while download pending, disable button during download
    - Display inline error message on download failure
    - Re-enable button after success or failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4_

  - [x] 6.2 Write component tests for download certificate UI
    - Test download button visible when certificate is valid
    - Test download button hidden when no certificate
    - Test click triggers download with correct URL
    - Test format selector has DER and PEM options with DER default
    - Test PEM selection appends `?format=pem`
    - Test DER selection uses URL without format param
    - Test disabled state when no certificate
    - Test loading spinner during pending download
    - Test error message on download failure
    - Test button re-enabled after success
    - File: `tests/components/SecuritySettings-download.test.tsx`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4_

- [x] 7. Implement browse buttons in SecuritySettings
  - [x] 7.1 Add "Browse" buttons adjacent to certificate and private key path inputs in `web/src/components/SecuritySettings.tsx`
    - Add "Browse" button next to certificate path input — calls `browseFiles` with extensions `[".der", ".pem", ".crt"]`
    - Add "Browse" button next to private key path input — calls `browseFiles` with extensions `[".key", ".pem"]`
    - Populate adjacent input field with selected path on success
    - Leave input unchanged on cancel (null response)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 7.2 Write component tests for browse buttons
    - Test browse button rendered for certificate input
    - Test browse button rendered for key input
    - Test certificate browse calls API with correct extensions
    - Test key browse calls API with correct extensions
    - Test selected cert path populates input
    - Test selected key path populates input
    - Test cancel leaves input unchanged
    - File: `tests/components/SecuritySettings-browse.test.tsx`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 8. Checkpoint - SecuritySettings complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement certificate health indicator in StatusBar
  - [x] 9.1 Add certificate days remaining indicator to `web/src/components/StatusBar.tsx`
    - Implement `getCertificateHealthColor(remainingDays: number)` helper: green (>90), yellow (30–90), red (1–29)
    - Display `🔒 {days}d` with color based on remaining days
    - Display "Expired" in red when days = 0
    - Hide indicator when no certificate data is available
    - Reuse `getSecurityConfig()` query from TanStack Query cache
    - Place between existing "connected clients" and "log toggle" elements
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 9.2 Write property test: Certificate days color classification (Property 3)
    - **Property 3: Certificate Days Color Classification**
    - For any positive integer, color function returns green when days > 90, yellow when 30 ≤ days ≤ 90, red when 1 ≤ days ≤ 29. For 0, display shows "Expired" in red
    - Use fast-check with `fc.nat()` generation
    - File: `tests/property/cert-export.test.ts`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

  - [x] 9.3 Write component tests for StatusBar certificate indicator
    - Test shows days in green when > 90
    - Test shows days in yellow when 30–90
    - Test shows days in red when 1–29
    - Test shows "Expired" in red when 0
    - Test hidden when no certificate data
    - File: `tests/components/StatusBar-certificate.test.tsx`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all code examples and implementations use TypeScript
- fast-check is already a project dependency

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.2", "4.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "4.2", "5.1"] },
    { "id": 3, "tasks": ["6.1", "7.1", "9.1"] },
    { "id": 4, "tasks": ["6.2", "7.2", "9.2", "9.3"] }
  ]
}
```

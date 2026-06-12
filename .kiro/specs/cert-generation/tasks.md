# Implementation Plan: In-App Self-Signed Certificate Generation

## Overview

Enhance the existing OPC UA Light Server with comprehensive self-signed certificate generation capabilities. The implementation builds on the existing `src/cert-generator/index.ts` module, `src/api/routes/security.ts` route, and `web/src/components/SecuritySettings.tsx` component. Key additions include input validation, file permission management, force-flag overwrite protection, HTTPS server support, and a certificate health display in the Web UI.

## Tasks

- [x] 1. Create validation module and enhance cert-generator interfaces
  - [x] 1.1 Create the input validation module at `src/cert-generator/validation.ts`
    - Implement `validateIpAddress(ip: string): boolean` for IPv4 dotted-decimal and IPv6 colon-hexadecimal formats
    - Implement `validateDnsName(dns: string): boolean` for hostname characters `[a-zA-Z0-9.-]` and ≤253 chars
    - Implement `validateCountryCode(code: string): boolean` for exactly 2 uppercase ASCII letters
    - Implement `validateCommonName(cn: string): boolean` for 1-64 chars after trim
    - Implement `validateOrganization(org: string): boolean` for 1-64 chars after trim
    - Implement `validateGenerateRequest(body: GenerateCertificateRequest): ValidationError[]` aggregating all field errors
    - All string inputs must be trimmed before validation
    - Export `ValidationError` interface with `field` and `message` properties
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 1.2 Update types at `src/types/api.ts` to include the `GenerateCertificateRequest` interface with all fields
    - Add `dnsNames?: string[]`, `ipAddresses?: string[]`, `organization?: string`, `country?: string`, `commonName?: string`, `force?: boolean`
    - Ensure existing `GenerateCertificateRequest` type is updated (not duplicated)
    - _Requirements: 4.1, 9.4_

  - [x] 1.3 Write property tests for validation (Properties 8, 9, 10, 11)
    - **Property 8: Invalid IP Rejection** — For any string not matching IPv4 dotted-decimal, `validateIpAddress` returns false
    - **Property 9: Invalid DNS Name Rejection** — For any empty string or string >253 chars, `validateDnsName` returns false
    - **Property 10: Invalid Country Code Rejection** — For any string not exactly 2 uppercase ASCII letters, `validateCountryCode` returns false
    - **Property 11: Whitespace Trimming Idempotence** — Trimmed inputs produce identical results to untrimmed equivalents
    - **Validates: Requirements 3.7, 3.8, 9.1, 9.2, 9.3, 9.4**
    - File: `tests/property/cert-validation.test.ts`

- [x] 2. Enhance the cert-generator core module
  - [x] 2.1 Refactor `src/cert-generator/index.ts` to implement enhanced generation logic
    - Add input validation call before generation (using validation module from 1.1)
    - Change serial number generation to random 8-20 bytes (currently fixed 16 bytes)
    - Set file permissions to 0o400 for the private key on POSIX systems
    - Add cleanup logic: if certificate write fails, remove the already-written key file
    - Ensure write ordering: key file is written before certificate file
    - Handle missing/empty `commonName` by defaulting to "OPC UA Light Server"
    - Omit Organization field from subject when not provided (currently defaults to "OPC UA Light Server")
    - Omit Country field from subject when not provided (currently defaults to "BR")
    - Always include `127.0.0.1` in SAN IP entries regardless of provided ipAddresses
    - Include Application URI `urn:opcua-light-server:application` as SAN URI entry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 Update `readCertificateExpiry` to handle expired certificates
    - Return `remainingDays: 0` for expired certificates (current implementation uses `Math.max(0, ...)` — verify correctness)
    - Return `null` without throwing when file does not exist or cannot be parsed
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x] 2.3 Write property tests for cert-generator (Properties 1, 2, 3, 4, 5, 6, 7, 12, 13)
    - **Property 1: Self-Signed Certificate** — Issuer and subject distinguished names are identical
    - **Property 2: Validity Period Exactness** — notAfter minus notBefore equals exactly 1825 days
    - **Property 3: Key-Pair Consistency** — Certificate public key modulus matches private key modulus
    - **Property 4: Distinguished Name Preservation** — Provided CN, O, C appear in certificate subject
    - **Property 5: SAN Minimum Entries** — Application URI and 127.0.0.1 always present in SAN
    - **Property 6: SAN IP Completeness** — All provided IPs plus 127.0.0.1 appear in SAN
    - **Property 7: SAN DNS Completeness** — All provided DNS names appear in SAN
    - **Property 12: Certificate Expiry Read Round-Trip** — Freshly generated cert returns remainingDays 1824-1825
    - **Property 13: Serial Number Byte Length** — Serial number is 8-20 bytes positive integer
    - **Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.6, 2.8, 3.1, 3.2, 3.4, 3.5, 3.6, 6.1, 6.2, 11.1, 11.2, 11.3, 11.4, 11.5**
    - File: `tests/property/cert-generator.test.ts`

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Enhance the Security API route
  - [x] 4.1 Refactor `src/api/routes/security.ts` POST `/generate` handler
    - Integrate the validation module: call `validateGenerateRequest` and return 400 with all errors aggregated
    - Trim whitespace on all string inputs before validation
    - Handle `force` field: treat non-boolean values as not set
    - Check certificate existence at `./data/certs/server.der` — reject with 400 if exists and force !== true
    - Proceed with generation regardless of force when no certificate exists
    - Return HTTP 201 on success with the full `SecurityConfig` including `certificateExpiresAt` and `certificateRemainingDays`
    - On generation failure (filesystem/internal error), return 500 and do NOT modify `security_config` table
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 4.2 Write unit tests for the enhanced security route
    - Test aggregated validation errors (multiple invalid fields → single 400 response)
    - Test force flag edge cases: force=undefined, force="true" (string), force=1 (number)
    - Test certificate existence check with and without force flag
    - Test successful generation returns 201 with SecurityConfig
    - Test filesystem error returns 500 without DB modification
    - File: `tests/unit/security-routes.test.ts` (extend existing)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.3, 5.4, 5.6, 9.5_

- [x] 5. Create HTTPS server module
  - [x] 5.1 Create `src/api/https-server.ts` module
    - Implement `shouldUseHttps(securityConfig): boolean` — returns true when mode is Sign or SignAndEncrypt and cert/key are configured
    - Implement `createHttpsServer(app, config): https.Server` — creates HTTPS server using cert and key files
    - Export `HttpsConfig` interface with `certPath` and `keyPath`
    - _Requirements: 10.1, 10.2_

  - [x] 5.2 Integrate HTTPS support into `src/api/server.ts`
    - At startup, read security config from DB
    - If `shouldUseHttps` returns true, attempt to create HTTPS server
    - If cert/key files cannot be read, fall back to HTTP and log warning
    - Use same PORT env variable (default 3100) for HTTPS when active
    - Do NOT auto-restart on new certificate generation (manual restart required)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.7, 10.8_

  - [x] 5.3 Write unit tests for the HTTPS server module
    - Test `shouldUseHttps` returns true for Sign/SignAndEncrypt with configured cert
    - Test `shouldUseHttps` returns false for None mode or missing cert
    - Test fallback to HTTP when cert file is unreadable
    - File: `tests/unit/https-server.test.ts`
    - _Requirements: 10.1, 10.2, 10.7_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Enhance Security Settings UI - Certificate Health Display
  - [x] 7.1 Add certificate remaining days display to `web/src/components/SecuritySettings.tsx`
    - Display remaining days as integer with dedicated label in upper section of the security settings page
    - Green indicator when remaining days > 90
    - Yellow/warning indicator when remaining days 30-90 (inclusive)
    - Red/critical indicator when remaining days < 30 and > 0
    - Display "Expired" with red indicator when remaining days is 0 or negative
    - Display expiry date in ISO 8601 format (YYYY-MM-DD) alongside remaining days
    - Display "No certificate expiry data available" message when no cert is configured
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 7.2 Add certificate generation form to `web/src/components/SecuritySettings.tsx`
    - Add "Generate Certificate" button
    - Add optional DNS names input (comma-separated or multi-line, max 20 entries, each ≤253 chars)
    - Add optional IP addresses input (comma-separated or multi-line, max 20 entries, valid IPv4/IPv6)
    - Client-side validation: show inline errors for invalid DNS/IP entries, prevent submission
    - When no SAN inputs provided, send request without SAN parameters
    - Disable button and show loading indicator while request is pending
    - On success: invalidate security config query cache, show success notification
    - On failure: display error message from API response
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 7.8, 7.9_

  - [x] 7.3 Add overwrite confirmation dialog to `web/src/components/SecuritySettings.tsx`
    - When certificate already exists and user clicks "Generate Certificate", show confirmation dialog
    - Confirmation dialog explains that existing certificate will be overwritten
    - On confirm: send request with `force=true`
    - On cancel: do not send request
    - _Requirements: 7.5_

  - [x] 7.4 Write component tests for SecuritySettings certificate features
    - Test "Generate Certificate" button renders
    - Test SAN input fields with validation feedback
    - Test confirmation dialog appears when cert exists
    - Test loading state during generation
    - Test success notification and cache invalidation
    - Test error display on failure
    - Test remaining days display with color indicators (green >90, yellow 30-90, red <30, "Expired" =0)
    - Test expiry date display format
    - Test "No certificate expiry data available" message
    - File: `tests/components/SecuritySettings.test.tsx`
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 8. Update Vite dev proxy for HTTPS support
  - [x] 8.1 Update `web/vite.config.ts` proxy configuration to support both HTTP and HTTPS backend
    - Support proxying to `https://localhost:3100` when backend uses HTTPS
    - Accept self-signed certificates in proxy configuration (set `secure: false`)
    - _Requirements: 10.5, 10.6_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `src/cert-generator/index.ts` already has basic generation and expiry reading — tasks enhance it with validation, permissions, cleanup, and edge case handling
- The existing `src/api/routes/security.ts` already has a POST `/generate` handler — tasks refactor it with proper validation and force-flag semantics
- The existing `web/src/components/SecuritySettings.tsx` already exists — tasks enhance it with the generation form and health display

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "4.1", "5.1"] },
    { "id": 3, "tasks": ["4.2", "5.2", "5.3"] },
    { "id": 4, "tasks": ["7.1", "7.2", "8.1"] },
    { "id": 5, "tasks": ["7.3"] },
    { "id": 6, "tasks": ["7.4"] }
  ]
}
```

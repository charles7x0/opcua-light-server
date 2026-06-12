# Implementation Plan: TOFU Client Certificate Trust

## Overview

Replace the current `UA_CertificateVerification_AcceptAll` with a Trust On First Use (TOFU) model spanning three layers: a TofuManager service in Node.js, a custom certificate verification callback in the C runtime, and a CertificatePanel in the React Web UI. Implementation proceeds bottom-up: shared utilities → service layer → API routes → runtime C code → config integration → Web UI.

## Tasks

- [ ] 1. Create TofuManager service and shared utilities
  - [x] 1.1 Create thumbprint validation utility and CertificateInfo type
    - Create `src/tofu-manager/index.ts` with the `CertificateInfo` interface and export it
    - Create `src/tofu-manager/thumbprint.ts` with `isValidThumbprint()` function using regex `/^[0-9a-f]{40}$/`
    - Export both from a barrel `src/tofu-manager/index.ts`
    - _Requirements: 4.4, 7.4, 8.8_

  - [x] 1.2 Write property test for thumbprint validation
    - **Property 10: Invalid Thumbprint Validation**
    - **Validates: Requirements 4.4, 7.4, 8.8**

  - [x] 1.3 Implement TofuManager.initialize() for PKI directory creation
    - Create `data/pki/`, `data/pki/trusted/`, and `data/pki/rejected/` using `fs.mkdirSync` with `recursive: true`
    - Log error and prevent runtime start if directory creation fails
    - Leave existing directories unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.4 Write property test for initialization idempotency
    - **Property 1: Initialization Idempotency**
    - **Validates: Requirements 1.4**

  - [x] 1.5 Implement TofuManager.listCertificates()
    - Read all `.der` files from both `trusted/` and `rejected/` directories
    - Parse each file using `node-forge` to extract subject CN, issuer CN, notBefore, notAfter
    - Return sorted array by thumbprint ascending, skip malformed files
    - Include fileSize from `fs.statSync`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 1.6 Write property test for certificate listing completeness and ordering
    - **Property 11: Certificate Listing Completeness and Ordering**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 1.7 Implement TofuManager.rejectCertificate()
    - Validate thumbprint exists in trust store, return 404 if not
    - Move file from `trusted/` to `rejected/` using `fs.renameSync`
    - Log rejection event
    - Call `signalReload()` after successful move
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 1.8 Write property test for reject operation state transition
    - **Property 6: Reject Operation State Transition**
    - **Validates: Requirements 4.1**

  - [x] 1.9 Implement TofuManager.trustCertificate()
    - Validate thumbprint exists in reject store, return 404 if not
    - Check if thumbprint already exists in trust store, return 409 conflict if so
    - Move file from `rejected/` to `trusted/` using `fs.renameSync`
    - Log re-trust event
    - Call `signalReload()` after successful move
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.10 Write property test for trust operation state transition
    - **Property 7: Trust Operation State Transition**
    - **Validates: Requirements 5.1**

  - [x] 1.11 Implement TofuManager.deleteCertificate()
    - Check both stores for the thumbprint, return 404 if not in either
    - Remove file using `fs.unlinkSync`
    - Log deletion event
    - Call `signalReload()` after successful deletion
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [x] 1.12 Write property test for delete operation removal
    - **Property 8: Delete Operation Removal**
    - **Validates: Requirements 7.1**

  - [x] 1.13 Write property test for non-existent thumbprint returns 404
    - **Property 9: Non-Existent Thumbprint Returns 404**
    - **Validates: Requirements 4.2, 5.2, 7.2**

  - [x] 1.14 Implement TofuManager.signalReload() and getPkiPaths()
    - `signalReload()` checks runtime status via ProcessManager, writes `{"type":"trust_store_reload"}\n` to stdin if running, logs deferral if not
    - `getPkiPaths()` returns absolute paths for trusted and rejected directories
    - _Requirements: 9.1, 9.5_

- [x] 2. Checkpoint - Ensure all TofuManager tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Create PKI REST API routes
  - [x] 3.1 Create PKI router with thumbprint validation middleware
    - Create `src/api/routes/pki.ts` with `createPkiRouter(tofuManager)` factory
    - Implement thumbprint validation middleware that returns 400 for invalid format
    - Wire authentication middleware on POST and DELETE routes
    - _Requirements: 8.5, 8.6, 8.7, 8.8_

  - [x] 3.2 Implement GET /api/pki/certificates endpoint
    - Call `tofuManager.listCertificates()` and return JSON array
    - No authentication required
    - _Requirements: 8.1, 8.6_

  - [x] 3.3 Implement POST /api/pki/certificates/:thumbprint/reject endpoint
    - Call `tofuManager.rejectCertificate(thumbprint)`
    - Return 204 on success, appropriate error codes on failure
    - Require authentication
    - _Requirements: 8.2, 8.5_

  - [x] 3.4 Implement POST /api/pki/certificates/:thumbprint/trust endpoint
    - Call `tofuManager.trustCertificate(thumbprint)`
    - Return 204 on success, appropriate error codes on failure
    - Require authentication
    - _Requirements: 8.3, 8.5_

  - [x] 3.5 Implement DELETE /api/pki/certificates/:thumbprint endpoint
    - Call `tofuManager.deleteCertificate(thumbprint)`
    - Return 204 on success, appropriate error codes on failure
    - Require authentication
    - _Requirements: 8.4, 8.5_

  - [x] 3.6 Write property test for authentication enforcement on mutations
    - **Property 13: Authentication Enforcement on Mutations**
    - **Validates: Requirements 8.5, 8.7**

  - [x] 3.7 Register PKI router in Express app and integrate TofuManager initialization
    - Import and mount `createPkiRouter` in `src/api/app.ts`
    - Instantiate TofuManager in the server startup sequence
    - Call `tofuManager.initialize()` before runtime start
    - _Requirements: 1.5, 8.1, 8.2, 8.3, 8.4_

- [x] 4. Checkpoint - Ensure API routes and TofuManager integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement C runtime custom certificate verifier
  - [x] 5.1 Create tofu_verifier.c with TofuVerifierContext and thumbprint computation
    - Create `runtime/src/tofu_verifier.c` and `runtime/src/tofu_verifier.h`
    - Implement `compute_thumbprint()` using SHA-1 to produce 40-char lowercase hex string
    - Define `TofuVerifierContext` struct with trusted_path and rejected_path fields
    - _Requirements: 10.2, 10.7_

  - [x] 5.2 Implement tofu_verify_certificate callback
    - Check reject store first (file existence via `access()` or `stat()`)
    - If in reject store → return `UA_STATUSCODE_BADCERTIFICATEUNTRUSTED`
    - Check trust store, if found → return `UA_STATUSCODE_GOOD`
    - If not in either store (TOFU) → write certificate to trust store, return `UA_STATUSCODE_GOOD`
    - If save fails → log error to stderr, still return `UA_STATUSCODE_GOOD`
    - If directories unreadable → return `UA_STATUSCODE_BADCERTIFICATEUNTRUSTED`
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 3.1, 3.2, 3.3, 3.4, 2.1, 2.2, 2.4_

  - [x] 5.3 Implement trust_store_reload IPC handler in main.c
    - Extend `apply_value_update` to recognize `"trust_store_reload"` message type
    - Log the reload request
    - If using direct filesystem checks, no-op; if caching added later, refresh here
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 5.4 Register custom verifier in configure_security replacing AcceptAll
    - Read `pkiTrustedPath` and `pkiRejectedPath` from JSON config
    - Initialize `TofuVerifierContext` with these paths
    - Register `tofu_verify_certificate` as the verification callback instead of `UA_CertificateVerification_AcceptAll`
    - _Requirements: 10.1, 10.7, 11.3_

  - [x] 5.5 Update CMakeLists.txt to include tofu_verifier.c
    - Add `src/tofu_verifier.c` to the source list in `runtime/CMakeLists.txt`
    - Ensure SHA-1 dependency is linked (mbedTLS or OpenSSL via open62541)
    - _Requirements: 10.1_

- [x] 6. Checkpoint - Build C runtime and verify compilation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Extend ConfigGenerator with PKI paths
  - [x] 7.1 Add pkiTrustedPath and pkiRejectedPath to SecurityConfigOutput
    - Extend the `SecurityConfigOutput` interface in the config-generator module
    - When mode is "Sign" or "SignAndEncrypt", include absolute paths to `data/pki/trusted` and `data/pki/rejected`
    - Omit fields when mode is "None"
    - Implement fallback to mode "None" if PKI directories are misconfigured, log warning
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 7.2 Write property test for config generator PKI path inclusion
    - **Property 12: Config Generator PKI Path Inclusion**
    - **Validates: Requirements 11.1, 11.2**

- [-] 8. Checkpoint - Ensure config generator tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Web UI CertificatePanel
  - [x] 9.1 Add PKI API client functions
    - Add `getPkiCertificates()`, `rejectPkiCertificate()`, `trustPkiCertificate()`, `deletePkiCertificate()` to `web/src/api.ts`
    - _Requirements: 12.4, 12.5, 12.7_

  - [x] 9.2 Create CertificatePanel component
    - Create `web/src/components/CertificatePanel.tsx`
    - Render table with columns: Thumbprint (first 16 hex chars), Subject, Status (badge), Expiry (YYYY-MM-DD)
    - Use TanStack React Query with `queryKey: ['pki-certificates']`
    - Display empty state message when no certificates exist
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 9.3 Implement certificate action buttons and confirmation dialog
    - Add Reject button for trusted certificates, Trust button for rejected certificates, Delete button for all
    - Delete button shows confirmation dialog before proceeding
    - On success, invalidate query to refresh the list
    - On API error, display inline error message preserving current list
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 9.4 Integrate CertificatePanel into SecuritySettings page
    - Import and render `CertificatePanel` within the existing SecuritySettings page, below existing certificate sections
    - _Requirements: 12.1_

  - [x] 9.5 Write component tests for CertificatePanel
    - Test table renders with mock data
    - Test empty state display
    - Test reject/trust button triggers API call and invalidation
    - Test delete confirmation flow
    - Test error display on API failure
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The C runtime changes (section 5) require a CMake rebuild after completion
- TofuManager uses synchronous file operations for atomicity on the same filesystem
- Certificate parsing uses `node-forge` which is already a project dependency

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.14"] },
    { "id": 3, "tasks": ["1.6", "1.7", "1.9", "1.11"] },
    { "id": 4, "tasks": ["1.8", "1.10", "1.12", "1.13"] },
    { "id": 5, "tasks": ["3.1", "5.1", "7.1"] },
    { "id": 6, "tasks": ["3.2", "3.3", "3.4", "3.5", "5.2"] },
    { "id": 7, "tasks": ["3.6", "3.7", "5.3", "5.4", "7.2"] },
    { "id": 8, "tasks": ["5.5", "9.1"] },
    { "id": 9, "tasks": ["9.2"] },
    { "id": 10, "tasks": ["9.3"] },
    { "id": 11, "tasks": ["9.4", "9.5"] }
  ]
}
```

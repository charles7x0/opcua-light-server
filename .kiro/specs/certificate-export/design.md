# Design Document: Certificate Export

## Overview

This feature adds certificate export capabilities to the OPC UA Light Server, enabling users to download the server's public X.509 certificate in DER or PEM format via a REST API endpoint and the web UI. It also adds a certificate health indicator in the status bar and file browse dialogs for the certificate upload form.

The design extends the existing security module with a new route handler for certificate downloads, a pure DER-to-PEM conversion utility, and frontend components for download controls and status display. Security is enforced by serving only the public certificate file referenced in the database — no user-supplied file paths are accepted.

### Key Design Decisions

1. **Single endpoint with format query parameter** — One route (`GET /api/security/certificate/download`) serves both DER and PEM formats via a `?format=` query parameter rather than separate endpoints. This keeps the API surface minimal and aligns with REST conventions.

2. **Pure conversion function** — The DER-to-PEM conversion is implemented as a standalone pure function (`derToPem`) with no side effects, making it trivial to unit test and property test independently of the HTTP layer.

3. **Server-side file picker** — Since this is a web application, the "Browse" button calls a server-side file picker endpoint (`POST /api/files/browse`) rather than the browser's native file dialog, because the browser cannot access server-side paths.

4. **Reuse existing security query** — The StatusBar certificate indicator reuses the same `getSecurityConfig()` query already used by SecuritySettings, avoiding duplicate API calls via TanStack Query's caching.

## Architecture

```mermaid
flowchart TD
    subgraph "Web UI (React)"
        SS[SecuritySettings.tsx]
        SB[StatusBar.tsx]
        API_CLIENT[api.ts]
    end

    subgraph "Control API (Express)"
        SEC_ROUTE[security.ts route]
        CERT_UTIL[cert-utils.ts]
        SEC_REPO[SecurityRepository]
        FILE_ROUTE[files.ts route]
    end

    subgraph "Storage"
        DB[(SQLite - security_config)]
        FS[Filesystem - data/certs/]
    end

    SS -->|"GET /api/security/certificate/download"| API_CLIENT
    SS -->|"POST /api/files/browse"| API_CLIENT
    SB -->|"GET /api/security"| API_CLIENT
    API_CLIENT --> SEC_ROUTE
    API_CLIENT --> FILE_ROUTE
    SEC_ROUTE --> CERT_UTIL
    SEC_ROUTE --> SEC_REPO
    SEC_REPO --> DB
    SEC_ROUTE -->|"readFileSync"| FS
    FILE_ROUTE -->|"readdir/stat"| FS
```

### Request Flow: Certificate Download

```mermaid
sequenceDiagram
    participant Client
    participant SecurityRoute
    participant SecurityRepo
    participant CertUtils
    participant FileSystem

    Client->>SecurityRoute: GET /api/security/certificate/download?format=pem
    SecurityRoute->>SecurityRoute: Validate format parameter
    SecurityRoute->>SecurityRepo: getCertificatePath()
    SecurityRepo-->>SecurityRoute: certificatePath
    alt No path configured
        SecurityRoute-->>Client: 404 CERTIFICATE_NOT_FOUND
    end
    SecurityRoute->>FileSystem: readFileSync(certificatePath)
    alt File read error
        SecurityRoute-->>Client: 500 INTERNAL_ERROR
    end
    alt format=pem
        SecurityRoute->>CertUtils: derToPem(buffer)
        CertUtils-->>SecurityRoute: PEM string
        SecurityRoute-->>Client: 200 (PEM, application/x-pem-file)
    else format=der (default)
        SecurityRoute-->>Client: 200 (DER buffer, application/x-x509-ca-cert)
    end
```

## Components and Interfaces

### Backend Components

#### 1. Certificate Download Route Handler

**Location:** `src/api/routes/security.ts` (extended)

New route added to the existing security router:

```typescript
// GET /api/security/certificate/download
router.get('/certificate/download', (req: Request, res: Response): void => { ... });
```

**Responsibilities:**
- Validate `format` query parameter (accept `der`, `pem` case-insensitive; default to `der`)
- Retrieve certificate path from `SecurityRepository` (database-only, no user input)
- Reject requests containing path traversal sequences with HTTP 403
- Read the certificate file from disk
- Convert to PEM if requested using `derToPem()`
- Set appropriate `Content-Type` and `Content-Disposition` headers
- Return error responses for missing file (404), invalid format (400), or read errors (500)

#### 2. DER-to-PEM Conversion Utility

**Location:** `src/cert-generator/cert-utils.ts` (new file)

```typescript
/**
 * Convert a DER-encoded certificate buffer to PEM format.
 * Pure function with no side effects.
 */
export function derToPem(derBuffer: Buffer): string;

/**
 * Decode a PEM-encoded certificate string back to DER binary buffer.
 * Pure function with no side effects.
 */
export function pemToDer(pemString: string): Buffer;
```

**Implementation Details:**
- Base64-encode the DER buffer
- Split into lines of exactly 64 characters
- Wrap with `-----BEGIN CERTIFICATE-----\n` header and `-----END CERTIFICATE-----\n` footer
- Use LF (`\n`) line endings throughout
- Output always ends with a trailing newline after the footer

#### 3. File Browse Route Handler

**Location:** `src/api/routes/files.ts` (new file)

```typescript
// POST /api/files/browse
router.post('/browse', (req: Request, res: Response): void => { ... });
```

**Request body:**
```typescript
interface FileBrowseRequest {
  /** Starting directory path (defaults to cwd) */
  startPath?: string;
  /** File extension filters (e.g., [".der", ".pem", ".crt"]) */
  extensions?: string[];
}
```

**Response:**
```typescript
interface FileBrowseResponse {
  /** Selected file's absolute path, or null if cancelled */
  selectedPath: string | null;
}
```

**Note:** Since this is a headless server (no native OS dialogs), this endpoint returns a directory listing filtered by extensions. The web UI presents a file picker UI that navigates the server filesystem via this API.

#### 4. SecurityRepository Extension

**Location:** `src/db/repositories/security-repository.ts` (extended)

New method:
```typescript
/**
 * Get only the certificate file path from the security configuration.
 * Returns null if no certificate path is configured.
 * Does NOT expose private key path.
 */
getCertificatePath(): string | null;
```

### Frontend Components

#### 5. SecuritySettings — Download Certificate Section

**Location:** `web/src/components/SecuritySettings.tsx` (extended)

New UI elements added within the "Certificate Status" section:
- **Format selector** (`<select>`) with DER and PEM options, DER pre-selected
- **"Download Certificate" button** visible only when `certificatePath` is present and `certificateValid` is true
- **Loading spinner** displayed while download is pending
- **Error message** displayed on download failure

**Download mechanism:** Creates a temporary `<a>` element pointing to the download URL, triggers click, browser handles the file save via `Content-Disposition` header.

#### 6. SecuritySettings — Browse Buttons

**Location:** `web/src/components/SecuritySettings.tsx` (extended)

New UI elements in the "Upload Certificate" section:
- **"Browse" button** adjacent to the certificate path input (filters: .der, .pem, .crt)
- **"Browse" button** adjacent to the private key path input (filters: .key, .pem)

Each button calls `POST /api/files/browse` with the appropriate extension filter and populates the adjacent input field with the response path.

#### 7. StatusBar — Certificate Days Indicator

**Location:** `web/src/components/StatusBar.tsx` (extended)

New indicator added between the existing "connected clients" and "log toggle" elements:
- Displays `🔒 {days}d` with color based on remaining days
- Color logic: green (>90), yellow/amber (30–90), red (1–29), "Expired" in red (0)
- Hidden when no certificate data is available
- Fetches data from `getSecurityConfig()` via the existing React Query cache

#### 8. API Client Extensions

**Location:** `web/src/api.ts` (extended)

```typescript
/**
 * Get the certificate download URL with optional format parameter.
 */
export function getCertificateDownloadUrl(format?: 'der' | 'pem'): string;

/**
 * Browse server-side files with optional extension filter.
 */
export function browseFiles(options?: { startPath?: string; extensions?: string[] }): Promise<{ selectedPath: string | null }>;
```

## Data Models

### API Request/Response Types

```typescript
// Error response (existing pattern)
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}

// Certificate download - no request body, query params only
// GET /api/security/certificate/download?format=der|pem

// File browse request
interface FileBrowseRequest {
  startPath?: string;
  extensions?: string[];
}

// File browse response
interface FileBrowseResponse {
  selectedPath: string | null;
}
```

### Database Schema

No schema changes required. The existing `security_config` table already stores `certificate_path` and `private_key_path`. The download endpoint reads `certificate_path` only.

### Color Classification Logic

```typescript
type CertificateHealthColor = 'green' | 'yellow' | 'red';

function getCertificateHealthColor(remainingDays: number): CertificateHealthColor {
  if (remainingDays > 90) return 'green';
  if (remainingDays >= 30) return 'yellow';
  return 'red';
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: DER-to-PEM Round Trip

*For any* valid byte buffer representing a DER-encoded certificate, converting it to PEM using `derToPem()` and then decoding the PEM back to binary using `pemToDer()` SHALL produce a byte-identical result to the original DER buffer.

**Validates: Requirements 3.4**

### Property 2: PEM Format Structural Invariant

*For any* valid byte buffer, converting it to PEM using `derToPem()` SHALL produce a string that: (a) begins with `-----BEGIN CERTIFICATE-----\n`, (b) ends with `-----END CERTIFICATE-----\n`, (c) contains only Base64 characters and newlines between header and footer, and (d) has all Base64 lines of exactly 64 characters except possibly the last line which has 1–64 characters.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 3: Certificate Days Color Classification

*For any* positive integer representing certificate remaining days, the color classification function SHALL return `green` when days > 90, `yellow` when 30 ≤ days ≤ 90, and `red` when 1 ≤ days ≤ 29. For days = 0, the display SHALL show "Expired" in red.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 4: Private Key Non-Exposure

*For any* valid request to the certificate download endpoint (regardless of format parameter), the response body and headers SHALL NOT contain PEM private key markers (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`) or raw private key binary content.

**Validates: Requirements 6.1**

### Property 5: Path Traversal Rejection

*For any* request to the certificate download endpoint containing path traversal sequences (`../`, `..\`, `%2e%2e/`, `%2e%2e\`) in query parameters, headers, or URL path segments, the endpoint SHALL respond with HTTP 403 Forbidden.

**Validates: Requirements 6.2**

## Error Handling

| Scenario | HTTP Status | Error Code | Message |
|----------|-------------|------------|---------|
| No certificate path configured | 404 | `CERTIFICATE_NOT_FOUND` | "No certificate is available for download" |
| Certificate file missing from disk | 404 | `CERTIFICATE_NOT_FOUND` | "Certificate file not found at configured path" |
| Filesystem read error | 500 | `INTERNAL_ERROR` | "Failed to read certificate file" |
| Invalid format parameter | 400 | `VALIDATION_ERROR` | "Invalid format. Valid options: der, pem" |
| Path traversal attempt | 403 | `ACCESS_DENIED` | "Access denied" |
| File browse - invalid start path | 400 | `VALIDATION_ERROR` | "Invalid start path" |
| File browse - path traversal attempt | 403 | `ACCESS_DENIED` | "Access denied" |

### Error Handling Strategy

- **Route handler level**: All errors are caught and returned as structured JSON `ErrorResponse` objects matching the project's existing pattern.
- **No stack traces in production**: Error messages are user-friendly and never expose internal paths or stack traces.
- **Frontend error display**: Download failures show an inline error message in the Certificate Status section. Browse failures show a toast or inline message.
- **Graceful degradation**: If the security config query fails, the StatusBar hides the certificate indicator rather than showing an error.

## Testing Strategy

### Unit Tests

**File:** `tests/unit/certificate-download.test.ts`

| Test Case | Validates |
|-----------|-----------|
| DER download returns 200 with correct Content-Type and Content-Disposition | Req 1.1, 1.2, 1.3 |
| PEM download returns 200 with PEM Content-Type and correct filename | Req 2.1, 2.2, 2.3 |
| Default format (no param) returns DER | Req 2.4 |
| Format parameter is case-insensitive | Req 2.1 |
| Invalid format returns 400 VALIDATION_ERROR | Req 2.5 |
| No certificate configured returns 404 | Req 1.4, 6.4 |
| Certificate file missing from disk returns 404 | Req 6.5 |
| Filesystem read error returns 500 | Req 1.5 |
| Response never contains private key markers | Req 6.1 |
| Path traversal in query params returns 403 | Req 6.2 |
| Endpoint reads from repo, not request params | Req 6.3 |

**File:** `tests/unit/cert-utils.test.ts`

| Test Case | Validates |
|-----------|-----------|
| derToPem produces valid PEM structure | Req 3.1 |
| PEM lines are 64 chars max | Req 3.2 |
| PEM ends with trailing newline | Req 3.3 |
| pemToDer reverses derToPem (specific examples) | Req 3.4 |

### Property-Based Tests

**File:** `tests/property/cert-export.test.ts`

Using **fast-check** (already a project dependency) with minimum 100 iterations per property.

| Property | Tag | Validates |
|----------|-----|-----------|
| DER-to-PEM round trip | Feature: certificate-export, Property 1: DER-to-PEM round trip | Req 3.4 |
| PEM format structural invariant | Feature: certificate-export, Property 2: PEM format structural invariant | Req 3.1, 3.2, 3.3 |
| Certificate days color classification | Feature: certificate-export, Property 3: Certificate days color classification | Req 7.1–7.5 |
| Private key non-exposure | Feature: certificate-export, Property 4: Private key non-exposure | Req 6.1 |
| Path traversal rejection | Feature: certificate-export, Property 5: Path traversal rejection | Req 6.2 |

### Component Tests

**File:** `tests/components/SecuritySettings-download.test.tsx`

| Test Case | Validates |
|-----------|-----------|
| Download button visible when certificate is valid | Req 4.1 |
| Download button hidden when no certificate | Req 4.3 |
| Click triggers download with correct URL | Req 4.2 |
| Format selector has DER and PEM options, DER default | Req 5.1 |
| PEM selection appends ?format=pem | Req 5.2 |
| DER selection uses URL without format param | Req 5.3 |
| Disabled state when no certificate | Req 5.4 |
| Loading spinner during pending download | Req 4.4 |
| Error message on download failure | Req 4.5 |
| Button re-enabled after success | Req 4.6 |

**File:** `tests/components/SecuritySettings-browse.test.tsx`

| Test Case | Validates |
|-----------|-----------|
| Browse button rendered for certificate input | Req 8.1 |
| Browse button rendered for key input | Req 8.4 |
| Certificate browse calls API with correct extensions | Req 8.2 |
| Key browse calls API with correct extensions | Req 8.5 |
| Selected cert path populates input | Req 8.3 |
| Selected key path populates input | Req 8.6 |
| Cancel leaves input unchanged | Req 8.7 |

**File:** `tests/components/StatusBar-certificate.test.tsx`

| Test Case | Validates |
|-----------|-----------|
| Shows days in green when > 90 | Req 7.2 |
| Shows days in yellow when 30–90 | Req 7.3 |
| Shows days in red when 1–29 | Req 7.4 |
| Shows "Expired" in red when 0 | Req 7.5 |
| Hidden when no certificate data | Req 7.6 |

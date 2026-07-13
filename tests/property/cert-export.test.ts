import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { derToPem, pemToDer } from '../../src/cert-generator/cert-utils.js';

// Mock fs module for controlling existsSync and readFileSync in Property 4 tests
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

// Mock cert-generator to prevent real certificate expiry checks
vi.mock('../../src/cert-generator/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/cert-generator/index.js')>();
  return {
    ...actual,
    generateCertificate: vi.fn(),
    readCertificateExpiry: vi.fn(() => null),
  };
});

// Mock React-related modules so we can import getCertificateHealthColor from StatusBar
vi.mock('react', () => ({
  useState: vi.fn(() => [null, vi.fn()]),
  useRef: vi.fn(() => ({ current: null })),
  useEffect: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined, isError: false })),
}));

vi.mock('../../web/src/api/index.js', () => ({
  getServerStatus: vi.fn(),
  getSystemLogs: vi.fn(),
  getSecurityConfig: vi.fn(),
}));

vi.mock('../../web/src/utils/formatUptime.js', () => ({
  formatUptime: vi.fn(() => '0s'),
}));

vi.mock('../../web/src/components/index.js', () => ({
  StatusDot: vi.fn(),
  StatusBarItem: vi.fn(),
  StatusBarAlert: vi.fn(),
  Button: vi.fn(),
}));

vi.mock('../../web/src/components/styles.js', () => ({
  statusDotColors: {},
}));

vi.mock('../../web/src/layout/LogPanel.js', () => ({
  LogPanel: vi.fn(),
}));

import { getCertificateHealthColor } from '../../web/src/layout/StatusBar.js';

import { existsSync, readFileSync } from 'fs';
import express from 'express';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';
import { createSecurityRouter } from '../../src/api/routes/security.js';

/**
 * Property 1: DER-to-PEM Round Trip
 *
 * For any valid byte buffer representing a DER-encoded certificate, converting
 * it to PEM using `derToPem()` and then decoding the PEM back to binary using
 * `pemToDer()` SHALL produce a byte-identical result to the original DER buffer.
 *
 * **Validates: Requirements 3.4**
 */
describe('Feature: certificate-export, Property 1: DER-to-PEM Round Trip', () => {
  it('pemToDer(derToPem(buffer)) produces byte-identical result to original buffer', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 1024 }),
        (bytes) => {
          const buffer = Buffer.from(bytes);
          const pem = derToPem(buffer);
          const roundTripped = pemToDer(pem);

          expect(Buffer.compare(roundTripped, buffer)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 2: PEM Format Structural Invariant
 *
 * For any valid byte buffer, `derToPem(buffer)` begins with
 * `-----BEGIN CERTIFICATE-----\n`, ends with `-----END CERTIFICATE-----\n`,
 * contains only Base64 characters and newlines between header and footer,
 * and all Base64 lines are exactly 64 characters except possibly the last
 * (1–64 characters).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */
describe('Feature: certificate-export, Property 2: PEM Format Structural Invariant', () => {
  const PEM_HEADER = '-----BEGIN CERTIFICATE-----\n';
  const PEM_FOOTER = '-----END CERTIFICATE-----\n';
  const BASE64_LINE_REGEX = /^[A-Za-z0-9+/=]+$/;

  it('derToPem output has correct header, footer, line lengths, and Base64-only content', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 1024 }),
        (bytes) => {
          const buffer = Buffer.from(bytes);
          const pem = derToPem(buffer);

          // Begins with header
          expect(pem.startsWith(PEM_HEADER)).toBe(true);
          // Ends with footer (trailing newline)
          expect(pem.endsWith(PEM_FOOTER)).toBe(true);

          // Extract body between header and footer
          const body = pem.slice(PEM_HEADER.length, pem.length - PEM_FOOTER.length);
          const lines = body.split('\n').filter((l) => l.length > 0);

          expect(lines.length).toBeGreaterThan(0);

          // All lines except possibly last are exactly 64 chars
          for (let i = 0; i < lines.length - 1; i++) {
            expect(lines[i].length).toBe(64);
          }

          // Last line is 1–64 chars
          const lastLine = lines[lines.length - 1];
          expect(lastLine.length).toBeGreaterThanOrEqual(1);
          expect(lastLine.length).toBeLessThanOrEqual(64);

          // All lines contain only Base64 characters
          for (const line of lines) {
            expect(BASE64_LINE_REGEX.test(line)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 3: Certificate Days Color Classification
 *
 * For any positive integer representing certificate remaining days, the color
 * classification function returns `green` when days > 90, `yellow` when
 * 30 ≤ days ≤ 90, and `red` when 1 ≤ days ≤ 29. For days = 0, the display
 * shows "Expired" in red.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
 */
describe('Feature: certificate-export, Property 3: Certificate Days Color Classification', () => {

  it('returns green for days > 90', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 91, max: 100000 }),
        (days) => {
          expect(getCertificateHealthColor(days)).toBe('green');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns yellow for days between 30 and 90 (inclusive)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 90 }),
        (days) => {
          expect(getCertificateHealthColor(days)).toBe('yellow');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns red for days between 1 and 29 (inclusive)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 29 }),
        (days) => {
          expect(getCertificateHealthColor(days)).toBe('red');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns red for days = 0 (expired)', () => {
    // Day 0 means expired — color function returns red
    expect(getCertificateHealthColor(0)).toBe('red');
  });

  it('color classification covers all non-negative integers correctly', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100000 }),
        (days) => {
          const color = getCertificateHealthColor(days);

          if (days > 90) {
            expect(color).toBe('green');
          } else if (days >= 30) {
            expect(color).toBe('yellow');
          } else {
            // days 0–29
            expect(color).toBe('red');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 4: Private Key Non-Exposure
 *
 * For any valid request to the certificate download endpoint (regardless of format parameter),
 * the response body and headers SHALL NOT contain PEM private key markers
 * (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`)
 * or raw private key binary content.
 *
 * **Validates: Requirements 6.1**
 */
describe('Feature: certificate-export, Property 4: Private Key Non-Exposure', () => {
  const PRIVATE_KEY_MARKERS = [
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----',
  ];

  const mockedExistsSync = vi.mocked(existsSync);
  const mockedReadFileSync = vi.mocked(readFileSync);

  let db: Database;
  let securityRepo: SecurityRepository;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    securityRepo = new SecurityRepository(db);
    app = express();
    app.use(express.json());
    app.use('/api/security', createSecurityRouter(securityRepo));

    // Configure a certificate path in the database
    const conn = db.getConnection();
    conn.prepare("UPDATE security_config SET certificate_path = './data/certs/server.der' WHERE id = 1").run();
    db.updateCache('security_config', []);

    // Mock filesystem: certificate file exists
    mockedExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  /**
   * Helper to make requests to the Express app and return response details.
   */
  function requestDownload(
    testApp: express.Express,
    format?: string
  ): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve) => {
      const url = format
        ? `/api/security/certificate/download?format=${format}`
        : '/api/security/certificate/download';

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const req = {
        method: 'GET',
        url,
        query: format ? { format } : {},
        headers,
        body: {},
        get(name: string) {
          return headers[name.toLowerCase()];
        },
      } as unknown as express.Request;

      let statusCode = 200;
      const resHeaders: Record<string, string> = {};
      let responseBody = '';

      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: unknown) {
          responseBody = JSON.stringify(data);
          resolve({ status: statusCode, body: responseBody, headers: resHeaders });
        },
        send(data: unknown) {
          if (Buffer.isBuffer(data)) {
            responseBody = data.toString('utf-8');
          } else if (typeof data === 'string') {
            responseBody = data;
          } else {
            responseBody = JSON.stringify(data);
          }
          resolve({ status: statusCode, body: responseBody, headers: resHeaders });
        },
        setHeader(name: string, value: string) {
          resHeaders[name.toLowerCase()] = value;
          return this;
        },
        getHeader(name: string) {
          return resHeaders[name.toLowerCase()];
        },
        end() {
          resolve({ status: statusCode, body: responseBody, headers: resHeaders });
        },
      } as unknown as express.Response;

      (app as any).handle(req, res, () => {
        resolve({ status: 404, body: '{"error":"Not found"}', headers: resHeaders });
      });
    });
  }

  it('response body never contains private key markers for DER format requests with arbitrary certificate bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        async (bytes) => {
          const buffer = Buffer.from(bytes);
          mockedReadFileSync.mockReturnValue(buffer);

          const response = await requestDownload(app, 'der');

          expect(response.status).toBe(200);

          // Check response body does not contain any private key markers
          for (const marker of PRIVATE_KEY_MARKERS) {
            expect(response.body).not.toContain(marker);
          }

          // Check response headers do not contain any private key markers
          const headersStr = JSON.stringify(response.headers);
          for (const marker of PRIVATE_KEY_MARKERS) {
            expect(headersStr).not.toContain(marker);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response body never contains private key markers for PEM format requests with arbitrary certificate bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        async (bytes) => {
          const buffer = Buffer.from(bytes);
          mockedReadFileSync.mockReturnValue(buffer);

          const response = await requestDownload(app, 'pem');

          expect(response.status).toBe(200);

          // Check response body does not contain any private key markers
          for (const marker of PRIVATE_KEY_MARKERS) {
            expect(response.body).not.toContain(marker);
          }

          // Check response headers do not contain any private key markers
          const headersStr = JSON.stringify(response.headers);
          for (const marker of PRIVATE_KEY_MARKERS) {
            expect(headersStr).not.toContain(marker);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response body never contains private key markers for default format (no param) with arbitrary certificate bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        async (bytes) => {
          const buffer = Buffer.from(bytes);
          mockedReadFileSync.mockReturnValue(buffer);

          const response = await requestDownload(app);

          expect(response.status).toBe(200);

          // Check response body does not contain any private key markers
          for (const marker of PRIVATE_KEY_MARKERS) {
            expect(response.body).not.toContain(marker);
          }

          // Check response headers do not contain any private key markers
          const headersStr = JSON.stringify(response.headers);
          for (const marker of PRIVATE_KEY_MARKERS) {
            expect(headersStr).not.toContain(marker);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Test helpers for Property 5 ---

function createTestApp(securityRepo: SecurityRepository): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/security', createSecurityRouter(securityRepo));
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url: path,
      path: path.split('?')[0],
      query: Object.fromEntries(new URLSearchParams(path.split('?')[1] || '').entries()),
      headers: { 'content-type': 'application/json' },
      body: {},
      get(name: string) {
        return (this.headers as Record<string, string>)[name.toLowerCase()];
      },
    } as unknown as express.Request;

    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: unknown) {
        resolve({ status: this.statusCode, body: data });
      },
      send(data: unknown) {
        resolve({ status: this.statusCode, body: data });
      },
      setHeader() {
        return this;
      },
      getHeader() {
        return undefined;
      },
      end() {
        resolve({ status: this.statusCode, body: undefined });
      },
    } as unknown as express.Response;

    app.handle(req as any, res as any, () => {
      resolve({ status: 404, body: { error: 'Not found' } });
    });
  });
}

/**
 * Property 5: Path Traversal Rejection
 *
 * For any request to the certificate download endpoint where the database-stored
 * certificate path contains path traversal sequences (`../`, `..\`, `%2e%2e/`, `%2e%2e\`),
 * the endpoint SHALL respond with HTTP 403 Forbidden.
 *
 * **Validates: Requirements 6.2**
 */
describe('Feature: certificate-export, Property 5: Path Traversal Rejection', () => {
  let db: Database;
  let securityRepo: SecurityRepository;
  let app: express.Express;

  const mockedExistsSync = vi.mocked(existsSync);
  const mockedReadFileSync = vi.mocked(readFileSync);

  beforeEach(() => {
    db = new Database(':memory:');
    securityRepo = new SecurityRepository(db);
    app = createTestApp(securityRepo);

    // Make file exist and readable so only the traversal check blocks the request
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(Buffer.from([0x30, 0x82, 0x01, 0x00]));
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  /**
   * Generator for path traversal sequences.
   */
  const traversalPatternArb = fc.constantFrom('../', '..\\', '%2e%2e/', '%2e%2e\\');

  /**
   * Generator for arbitrary path segments (directory/file names).
   */
  const pathSegmentArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
    { minLength: 1, maxLength: 20 }
  );

  /**
   * Generator for certificate paths containing traversal sequences.
   * Combines path segments with traversal patterns to produce realistic malicious paths.
   */
  const traversalPathArb = fc.tuple(
    fc.array(pathSegmentArb, { minLength: 0, maxLength: 3 }),
    traversalPatternArb,
    fc.array(pathSegmentArb, { minLength: 1, maxLength: 3 })
  ).map(([prefix, traversal, suffix]) => {
    const prefixStr = prefix.length > 0 ? '/' + prefix.join('/') + '/' : '/';
    const suffixStr = suffix.join('/') + '.der';
    return prefixStr + traversal + suffixStr;
  });

  it('responds with HTTP 403 when database-stored cert path contains traversal sequences', async () => {
    await fc.assert(
      fc.asyncProperty(traversalPathArb, async (maliciousPath) => {
        // Configure the database to return a path with traversal sequence
        const conn = db.getConnection();
        conn.prepare(
          'UPDATE security_config SET certificate_path = ? WHERE id = 1'
        ).run(maliciousPath);
        db.updateCache('security_config', []);

        // Make a request to the download endpoint
        const res = await request(app, 'GET', '/api/security/certificate/download');

        // Must return 403 with ACCESS_DENIED error code
        expect(res.status).toBe(403);
        const body = res.body as { error: { code: string; message: string } };
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe('ACCESS_DENIED');
        expect(body.error.message).toBe('Access denied');
      }),
      { numRuns: 100 }
    );
  });

  it('responds with HTTP 403 regardless of format query parameter', async () => {
    const formatArb = fc.constantFrom('der', 'pem', 'DER', 'PEM', 'Pem', 'Der');

    await fc.assert(
      fc.asyncProperty(traversalPathArb, formatArb, async (maliciousPath, format) => {
        // Configure the database to return a path with traversal sequence
        const conn = db.getConnection();
        conn.prepare(
          'UPDATE security_config SET certificate_path = ? WHERE id = 1'
        ).run(maliciousPath);
        db.updateCache('security_config', []);

        // Make a request with format parameter
        const res = await request(app, 'GET', `/api/security/certificate/download?format=${format}`);

        // Must return 403 regardless of format
        expect(res.status).toBe(403);
        const body = res.body as { error: { code: string; message: string } };
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe('ACCESS_DENIED');
      }),
      { numRuns: 100 }
    );
  });
});

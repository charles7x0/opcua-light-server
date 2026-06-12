import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';
import { createSecurityRouter } from '../../src/api/routes/security.js';

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

// Mock cert-generator to prevent actual file system reads for expiry
vi.mock('../../src/cert-generator/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/cert-generator/index.js')>();
  return {
    ...actual,
    generateCertificate: vi.fn(actual.generateCertificate),
    readCertificateExpiry: vi.fn(() => null),
  };
});

import { existsSync, readFileSync } from 'fs';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

/**
 * Helper to create a test Express app with the security router.
 */
function createTestApp(securityRepo: SecurityRepository): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/security', createSecurityRouter(securityRepo));
  return app;
}

/**
 * Request helper that invokes Express handlers directly.
 * Supports query parameters parsed from the URL.
 */
async function request(
  app: Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    // Parse query params from the path
    const [pathname, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      for (const param of queryString.split('&')) {
        const [key, value] = param.split('=');
        query[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
      }
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const req = {
      method: method.toUpperCase(),
      url: path,
      path: pathname,
      headers,
      query,
      body: body ?? {},
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    } as unknown as express.Request;

    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    const chunks: Buffer[] = [];

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return this;
      },
      getHeader(name: string) {
        return responseHeaders[name.toLowerCase()];
      },
      json(data: unknown) {
        responseHeaders['content-type'] = 'application/json';
        resolve({ status: statusCode, body: data, headers: responseHeaders });
      },
      send(data: unknown) {
        if (Buffer.isBuffer(data)) {
          resolve({ status: statusCode, body: data, headers: responseHeaders });
        } else if (typeof data === 'string') {
          resolve({ status: statusCode, body: data, headers: responseHeaders });
        } else {
          resolve({ status: statusCode, body: data, headers: responseHeaders });
        }
      },
      end() {
        resolve({ status: statusCode, body: undefined, headers: responseHeaders });
      },
    } as unknown as express.Response;

    (app as any).handle(req as any, res as any, () => {
      resolve({ status: 404, body: { error: 'Not found' }, headers: responseHeaders });
    });
  });
}

describe('Certificate Download Endpoint', () => {
  let db: Database;
  let securityRepo: SecurityRepository;
  let app: Express;

  // Sample DER certificate bytes (arbitrary valid buffer for testing)
  const sampleDerBuffer = Buffer.from([
    0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00,
    0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01, 0x00, 0xc4, 0xa5, 0xb8,
  ]);

  beforeEach(() => {
    db = new Database(':memory:');
    securityRepo = new SecurityRepository(db);
    app = createTestApp(securityRepo);

    // Default: no file exists
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue(sampleDerBuffer);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  /**
   * Helper to configure a certificate path in the database.
   */
  function configureCertificate(certPath: string): void {
    const conn = db.getConnection();
    conn.prepare("UPDATE security_config SET certificate_path = ? WHERE id = 1").run(certPath);
    db.updateCache('security_config', []);
  }

  describe('GET /api/security/certificate/download', () => {
    it('should return 200 with correct Content-Type and Content-Disposition for DER download', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download?format=der');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-x509-ca-cert');
      expect(res.headers['content-disposition']).toBe('attachment; filename="server.der"');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(Buffer.compare(res.body as Buffer, sampleDerBuffer)).toBe(0);
    });

    it('should return 200 with PEM Content-Type and correct filename for PEM download', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download?format=pem');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-pem-file');
      expect(res.headers['content-disposition']).toBe('attachment; filename="server.pem"');
      // Verify PEM structure
      const pemContent = res.body as string;
      expect(pemContent).toContain('-----BEGIN CERTIFICATE-----');
      expect(pemContent).toContain('-----END CERTIFICATE-----');
    });

    it('should default to DER format when no format parameter is provided', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-x509-ca-cert');
      expect(res.headers['content-disposition']).toBe('attachment; filename="server.der"');
    });

    it('should treat format parameter as case-insensitive (PEM)', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download?format=PEM');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-pem-file');
      expect(res.headers['content-disposition']).toBe('attachment; filename="server.pem"');
    });

    it('should treat format parameter as case-insensitive (DER mixed case)', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download?format=Der');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-x509-ca-cert');
    });

    it('should return 400 VALIDATION_ERROR for invalid format parameter', async () => {
      configureCertificate('./data/certs/server.der');

      const res = await request(app, 'GET', '/api/security/certificate/download?format=xml');

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid format');
      expect(body.error.message).toContain('der');
      expect(body.error.message).toContain('pem');
    });

    it('should return 404 when no certificate is configured', async () => {
      // No certificate path configured (default state)
      const res = await request(app, 'GET', '/api/security/certificate/download');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('CERTIFICATE_NOT_FOUND');
      expect(body.error.message).toContain('No certificate is available');
    });

    it('should return 404 when certificate file is missing from disk', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(false);

      const res = await request(app, 'GET', '/api/security/certificate/download');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('CERTIFICATE_NOT_FOUND');
      expect(body.error.message).toContain('not found at configured path');
    });

    it('should return 500 when filesystem read error occurs', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const res = await request(app, 'GET', '/api/security/certificate/download');

      expect(res.status).toBe(500);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('Failed to read certificate file');
    });

    it('should never contain private key markers in DER response', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download?format=der');

      expect(res.status).toBe(200);
      const bodyStr = Buffer.isBuffer(res.body) ? (res.body as Buffer).toString() : String(res.body);
      expect(bodyStr).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(bodyStr).not.toContain('-----BEGIN PRIVATE KEY-----');
      expect(bodyStr).not.toContain('-----BEGIN EC PRIVATE KEY-----');
    });

    it('should never contain private key markers in PEM response', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      const res = await request(app, 'GET', '/api/security/certificate/download?format=pem');

      expect(res.status).toBe(200);
      const bodyStr = String(res.body);
      expect(bodyStr).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(bodyStr).not.toContain('-----BEGIN PRIVATE KEY-----');
      expect(bodyStr).not.toContain('-----BEGIN EC PRIVATE KEY-----');
    });

    it('should return 403 when certificate path in DB contains path traversal (../)', async () => {
      configureCertificate('../../../etc/passwd');
      mockedExistsSync.mockReturnValue(true);

      const res = await request(app, 'GET', '/api/security/certificate/download');

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ACCESS_DENIED');
      expect(body.error.message).toContain('Access denied');
    });

    it('should return 403 when certificate path in DB contains backslash path traversal (..\\)', async () => {
      configureCertificate('..\\..\\windows\\system32\\config');
      mockedExistsSync.mockReturnValue(true);

      const res = await request(app, 'GET', '/api/security/certificate/download');

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ACCESS_DENIED');
    });

    it('should read certificate path from repository, not from request params', async () => {
      configureCertificate('./data/certs/server.der');
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(sampleDerBuffer);

      // Even with a different path in query params, should use DB path
      const res = await request(
        app,
        'GET',
        '/api/security/certificate/download?path=/etc/passwd&file=secrets.key'
      );

      expect(res.status).toBe(200);
      // Verify readFileSync was called with the DB path, not the query param
      expect(mockedReadFileSync).toHaveBeenCalledWith('./data/certs/server.der');
    });
  });
});

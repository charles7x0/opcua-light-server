import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';
import { createSecurityRouter } from '../../src/api/routes/security.js';

/**
 * Helper to make requests to the Express app without a real HTTP server.
 * Uses a lightweight approach with supertest-like behavior via direct handler invocation.
 */
function createTestApp(securityRepo: SecurityRepository): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/security', createSecurityRouter(securityRepo));
  return app;
}

/**
 * Simple request helper that invokes Express handlers directly.
 */
async function request(app: Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url: path,
      headers: { 'content-type': 'application/json' },
      body: body ?? {},
      get(name: string) {
        return (this.headers as Record<string, string>)[name.toLowerCase()];
      },
    } as unknown as express.Request;

    const chunks: Buffer[] = [];
    let statusCode = 200;

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        resolve({ status: statusCode, body: data });
      },
      send(data: unknown) {
        resolve({ status: statusCode, body: data });
      },
      setHeader() { return this; },
      getHeader() { return undefined; },
      end() {
        resolve({ status: statusCode, body: undefined });
      },
    } as unknown as express.Response;

    // Use the app's handle method to route the request
    app.handle(req as any, res as any, () => {
      resolve({ status: 404, body: { error: 'Not found' } });
    });
  });
}

describe('Security API Routes', () => {
  let db: Database;
  let securityRepo: SecurityRepository;
  let app: Express;

  beforeEach(() => {
    db = new Database(':memory:');
    securityRepo = new SecurityRepository(db);
    app = createTestApp(securityRepo);
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /api/security', () => {
    it('should return default security config', async () => {
      const res = await request(app, 'GET', '/api/security');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        mode: 'None',
        privateKeyConfigured: false,
      });
    });

    it('should return config with certificate path when configured', async () => {
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.pem' WHERE id = 1").run();
      // Invalidate cache
      db.updateCache('security_config', []);

      const res = await request(app, 'GET', '/api/security');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.certificatePath).toBe('/certs/server.pem');
      expect(body.mode).toBe('None');
    });

    it('should never expose private key path in response', async () => {
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET private_key_path = '/secret/private.key' WHERE id = 1").run();
      db.updateCache('security_config', []);

      const res = await request(app, 'GET', '/api/security');

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.privateKeyConfigured).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('/secret/private.key');
      expect(body['privateKeyPath']).toBeUndefined();
      expect(body['private_key_path']).toBeUndefined();
    });
  });

  describe('PUT /api/security/policy', () => {
    it('should update security mode to Sign', async () => {
      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'Sign' });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBe('Sign');
    });

    it('should update security mode to SignAndEncrypt', async () => {
      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBe('SignAndEncrypt');
    });

    it('should return 400 for missing mode', async () => {
      const res = await request(app, 'PUT', '/api/security/policy', {});

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContainEqual(
        expect.objectContaining({ field: 'mode' })
      );
    });

    it('should return 400 for invalid mode value', async () => {
      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'InvalidMode' });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid security mode');
    });

    it('should persist the mode change', async () => {
      await request(app, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

      const config = securityRepo.get();
      expect(config.mode).toBe('SignAndEncrypt');
    });
  });

  describe('POST /api/security/certificate', () => {
    it('should upload valid certificate paths', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.pem',
        privateKeyPath: '/keys/private.key',
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.certificatePath).toBe('/certs/server.pem');
      expect(body.privateKeyConfigured).toBe(true);
    });

    it('should accept .der certificate extension', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.der',
        privateKeyPath: '/keys/private.pem',
      });

      expect(res.status).toBe(200);
    });

    it('should accept .crt certificate extension', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.crt',
        privateKeyPath: '/keys/private.key',
      });

      expect(res.status).toBe(200);
    });

    it('should return 400 for missing certificatePath', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        privateKeyPath: '/keys/private.key',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContainEqual(
        expect.objectContaining({ field: 'certificatePath' })
      );
    });

    it('should return 400 for missing privateKeyPath', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.pem',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContainEqual(
        expect.objectContaining({ field: 'privateKeyPath' })
      );
    });

    it('should return 400 for invalid certificate extension', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.txt',
        privateKeyPath: '/keys/private.key',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContainEqual(
        expect.objectContaining({ field: 'certificatePath' })
      );
    });

    it('should return 400 for invalid private key extension', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.pem',
        privateKeyPath: '/keys/private.txt',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContainEqual(
        expect.objectContaining({ field: 'privateKeyPath' })
      );
    });

    it('should never expose private key path in response', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '/certs/server.pem',
        privateKeyPath: '/keys/super-secret-private.key',
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      // The response should indicate key is configured but not expose the path
      expect(body.privateKeyConfigured).toBe(true);
      expect(body['privateKeyPath']).toBeUndefined();
      expect(body['private_key_path']).toBeUndefined();
      // The private key path should not appear anywhere in the serialized response
      expect(JSON.stringify(res.body)).not.toContain('super-secret-private');
    });

    it('should return 400 for empty string certificatePath', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '',
        privateKeyPath: '/keys/private.key',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for whitespace-only certificatePath', async () => {
      const res = await request(app, 'POST', '/api/security/certificate', {
        certificatePath: '   ',
        privateKeyPath: '/keys/private.key',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

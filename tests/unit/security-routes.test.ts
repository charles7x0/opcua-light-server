import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';
import { createSecurityRouter } from '../../src/api/routes/security.js';
import { existsSync } from 'fs';
import { generateCertificate, readCertificateExpiry } from '../../src/cert-generator/index.js';

// Mock fs module for controlling existsSync in generate tests
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

// Mock cert-generator for controlling generateCertificate in generate tests
vi.mock('../../src/cert-generator/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/cert-generator/index.js')>();
  return {
    ...actual,
    generateCertificate: vi.fn(actual.generateCertificate),
    readCertificateExpiry: vi.fn(() => null),
  };
});

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
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const req = {
      method: method.toUpperCase(),
      url: path,
      headers,
      body: body ?? {},
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    } as unknown as express.Request;

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
    (app as any).handle(req as any, res as any, () => {
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
      // Configure certificate first (required for non-None modes)
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1").run();
      db.updateCache('security_config', []);

      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'Sign' });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBe('Sign');
    });

    it('should update security mode to SignAndEncrypt', async () => {
      // Configure certificate first (required for non-None modes)
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1").run();
      db.updateCache('security_config', []);

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

    it('should return 400 when setting Sign without certificate configured', async () => {
      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'Sign' });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('requires a certificate');
    });

    it('should return 400 when setting SignAndEncrypt without certificate configured', async () => {
      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string; details?: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('requires a certificate');
      expect(body.error.details).toContainEqual(expect.objectContaining({ field: 'certificatePath' }));
    });

    it('should allow setting Sign when certificate is configured', async () => {
      // Configure certificate paths first
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1").run();
      db.updateCache('security_config', []);

      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'Sign' });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBe('Sign');
    });

    it('should allow setting SignAndEncrypt when certificate is configured', async () => {
      // Configure certificate paths first
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1").run();
      db.updateCache('security_config', []);

      const res = await request(app, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBe('SignAndEncrypt');
    });

    it('should persist the mode change', async () => {
      // Configure certificate first
      const conn = db.getConnection();
      conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1").run();
      db.updateCache('security_config', []);

      await request(app, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

      const config = securityRepo.get();
      expect(config.mode).toBe('SignAndEncrypt');
    });

    describe('runtime restart on policy change', () => {
      let mockProcessManager: {
        getStatus: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
      };
      let mockConfigGenerator: {
        writeToFile: ReturnType<typeof vi.fn>;
      };
      let mockConnectorRegistry: {
        stopAll: ReturnType<typeof vi.fn>;
        startAll: ReturnType<typeof vi.fn>;
      };
      let appWithDeps: Express;

      beforeEach(() => {
        mockProcessManager = {
          getStatus: vi.fn().mockReturnValue({ state: 'running', pid: 1234 }),
          stop: vi.fn().mockResolvedValue(undefined),
          start: vi.fn().mockResolvedValue({ pid: 5678, startedAt: new Date() }),
        };
        mockConfigGenerator = {
          writeToFile: vi.fn(),
        };
        mockConnectorRegistry = {
          stopAll: vi.fn(),
          startAll: vi.fn(),
        };

        // Configure certificate so non-None modes are accepted
        const conn = db.getConnection();
        conn.prepare("UPDATE security_config SET certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1").run();
        db.updateCache('security_config', []);

        appWithDeps = express();
        appWithDeps.use(express.json());
        appWithDeps.use('/api/security', createSecurityRouter(securityRepo, {
          processManager: mockProcessManager as any,
          configGenerator: mockConfigGenerator as any,
          connectorRegistry: mockConnectorRegistry as any,
        }));
      });

      it('should restart the runtime when mode changes and runtime is running', async () => {
        const res = await request(appWithDeps, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        expect(res.status).toBe(200);
        expect(mockConfigGenerator.writeToFile).toHaveBeenCalledWith('runtime/config.json');
        expect(mockProcessManager.stop).toHaveBeenCalled();
        expect(mockProcessManager.start).toHaveBeenCalled();
      });

      it('should stop connectors before runtime shutdown and restart after', async () => {
        const callOrder: string[] = [];
        mockConnectorRegistry.stopAll.mockImplementation(() => { callOrder.push('connectors:stop'); });
        mockProcessManager.stop.mockImplementation(async () => { callOrder.push('runtime:stop'); });
        mockProcessManager.start.mockImplementation(async () => { callOrder.push('runtime:start'); return { pid: 5678, startedAt: new Date() }; });
        mockConnectorRegistry.startAll.mockImplementation(() => { callOrder.push('connectors:start'); });

        await request(appWithDeps, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        expect(callOrder).toEqual(['connectors:stop', 'runtime:stop', 'runtime:start', 'connectors:start']);
      });

      it('should regenerate config before stopping the runtime', async () => {
        const callOrder: string[] = [];
        mockConfigGenerator.writeToFile.mockImplementation(() => { callOrder.push('writeConfig'); });
        mockConnectorRegistry.stopAll.mockImplementation(() => { callOrder.push('connectors:stop'); });
        mockProcessManager.stop.mockImplementation(async () => { callOrder.push('runtime:stop'); });
        mockProcessManager.start.mockImplementation(async () => { callOrder.push('runtime:start'); return { pid: 5678, startedAt: new Date() }; });
        mockConnectorRegistry.startAll.mockImplementation(() => { callOrder.push('connectors:start'); });

        await request(appWithDeps, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        expect(callOrder[0]).toBe('connectors:stop');
        expect(callOrder[1]).toBe('writeConfig');
        expect(callOrder[2]).toBe('runtime:stop');
        expect(callOrder[3]).toBe('runtime:start');
        expect(callOrder[4]).toBe('connectors:start');
      });

      it('should NOT restart if runtime is not running', async () => {
        mockProcessManager.getStatus.mockReturnValue({ state: 'stopped' });

        const res = await request(appWithDeps, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        expect(res.status).toBe(200);
        expect(mockProcessManager.stop).not.toHaveBeenCalled();
        expect(mockProcessManager.start).not.toHaveBeenCalled();
        expect(mockConfigGenerator.writeToFile).not.toHaveBeenCalled();
        expect(mockConnectorRegistry.stopAll).not.toHaveBeenCalled();
        expect(mockConnectorRegistry.startAll).not.toHaveBeenCalled();
      });

      it('should NOT restart if no processManager is provided', async () => {
        // Use the app without deps (original app from outer beforeEach)
        const res = await request(app, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        expect(res.status).toBe(200);
        // No crash — graceful degradation when processManager is not available
      });

      it('should still return success even if restart fails', async () => {
        mockProcessManager.stop.mockRejectedValue(new Error('stop failed'));

        const res = await request(appWithDeps, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        // Policy was persisted successfully even if restart fails
        expect(res.status).toBe(200);
        const body = res.body as Record<string, unknown>;
        expect(body.mode).toBe('SignAndEncrypt');
      });

      it('should persist the new mode regardless of restart outcome', async () => {
        mockProcessManager.stop.mockRejectedValue(new Error('stop failed'));

        await request(appWithDeps, 'PUT', '/api/security/policy', { mode: 'Sign' });

        const config = securityRepo.get();
        expect(config.mode).toBe('Sign');
      });

      it('should use custom configFilePath when provided', async () => {
        const customApp = express();
        customApp.use(express.json());
        customApp.use('/api/security', createSecurityRouter(securityRepo, {
          processManager: mockProcessManager as any,
          configGenerator: mockConfigGenerator as any,
          configFilePath: '/custom/path/config.json',
        }));

        await request(customApp, 'PUT', '/api/security/policy', { mode: 'SignAndEncrypt' });

        expect(mockConfigGenerator.writeToFile).toHaveBeenCalledWith('/custom/path/config.json');
      });
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

  describe('POST /api/security/generate', () => {
    const mockedExistsSync = vi.mocked(existsSync);
    const mockedGenerateCertificate = vi.mocked(generateCertificate);
    const mockedReadCertificateExpiry = vi.mocked(readCertificateExpiry);

    beforeEach(() => {
      // By default: no existing certificate, generation succeeds
      mockedExistsSync.mockReturnValue(false);
      mockedGenerateCertificate.mockReturnValue({
        certificatePath: './data/certs/server.der',
        privateKeyPath: './data/certs/server.key',
        expiresAt: '2031-06-09T12:00:00.000Z',
        createdAt: '2026-06-10T12:00:00.000Z',
      });
      mockedReadCertificateExpiry.mockReturnValue({
        expiresAt: '2031-06-09T12:00:00.000Z',
        createdAt: '2026-06-10T12:00:00.000Z',
        remainingDays: 1825,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // --- Aggregated validation errors ---

    it('should return 400 with all validation errors aggregated in a single response', async () => {
      const res = await request(app, 'POST', '/api/security/generate', {
        country: 'invalid',
        ipAddresses: ['not-an-ip'],
        dnsNames: ['invalid dns!'],
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: Array<{ field: string; message: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toBeInstanceOf(Array);
      // Should contain errors for country, ipAddresses, and dnsNames
      const fields = body.error.details.map((d) => d.field);
      expect(fields).toContain('country');
      expect(fields).toContain('ipAddresses');
      expect(fields).toContain('dnsNames');
    });

    it('should return 400 with details for a single invalid field', async () => {
      const res = await request(app, 'POST', '/api/security/generate', {
        country: 'XYZ',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: Array<{ field: string }> } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toHaveLength(1);
      expect(body.error.details[0].field).toBe('country');
    });

    // --- Force flag edge cases ---

    it('should return 400 when force=undefined and certificate exists', async () => {
      mockedExistsSync.mockReturnValue(true);

      const res = await request(app, 'POST', '/api/security/generate', {});

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Certificate already exists');
    });

    it('should return 400 when force="true" (string) and certificate exists', async () => {
      mockedExistsSync.mockReturnValue(true);

      const res = await request(app, 'POST', '/api/security/generate', {
        force: 'true',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Certificate already exists');
    });

    it('should return 400 when force=1 (number) and certificate exists', async () => {
      mockedExistsSync.mockReturnValue(true);

      const res = await request(app, 'POST', '/api/security/generate', {
        force: 1,
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Certificate already exists');
    });

    // --- Certificate existence check with force flag ---

    it('should return 201 when force=true and certificate exists (overwrite allowed)', async () => {
      mockedExistsSync.mockReturnValue(true);

      const res = await request(app, 'POST', '/api/security/generate', {
        force: true,
      });

      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBeDefined();
      expect(body.privateKeyConfigured).toBe(true);
    });

    it('should return 201 when no certificate exists and force is not set', async () => {
      mockedExistsSync.mockReturnValue(false);

      const res = await request(app, 'POST', '/api/security/generate', {});

      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(body.mode).toBeDefined();
    });

    it('should return 201 when no certificate exists regardless of force=false', async () => {
      mockedExistsSync.mockReturnValue(false);

      const res = await request(app, 'POST', '/api/security/generate', {
        force: false,
      });

      expect(res.status).toBe(201);
    });

    // --- Successful generation returns 201 with SecurityConfig ---

    it('should return 201 with SecurityConfig including expiry fields on success', async () => {
      mockedExistsSync.mockReturnValue(false);

      const res = await request(app, 'POST', '/api/security/generate', {
        commonName: 'Test Server',
        organization: 'Test Org',
        country: 'US',
      });

      expect(res.status).toBe(201);
      const body = res.body as {
        mode: string;
        certificatePath: string;
        privateKeyConfigured: boolean;
        certificateExpiresAt?: string;
        certificateRemainingDays?: number;
      };
      expect(body.mode).toBe('None');
      expect(body.certificatePath).toBe('./data/certs/server.der');
      expect(body.privateKeyConfigured).toBe(true);
      expect(body.certificateExpiresAt).toBe('2031-06-09T12:00:00.000Z');
      expect(body.certificateRemainingDays).toBe(1825);
    });

    it('should call generateCertificate with trimmed inputs', async () => {
      mockedExistsSync.mockReturnValue(false);

      await request(app, 'POST', '/api/security/generate', {
        commonName: '  My Server  ',
        organization: '  My Org  ',
        country: '  US  ',
      });

      expect(mockedGenerateCertificate).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          commonName: 'My Server',
          organization: 'My Org',
          country: 'US',
        })
      );
    });

    // --- Filesystem error returns 500 without DB modification ---

    it('should return 500 with INTERNAL_ERROR when generation throws', async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedGenerateCertificate.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const res = await request(app, 'POST', '/api/security/generate', {});

      expect(res.status).toBe(500);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('permission denied');
    });

    it('should not modify security_config when generation fails', async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedGenerateCertificate.mockImplementation(() => {
        throw new Error('Disk full');
      });

      // Record the config before the failed attempt
      const configBefore = securityRepo.get();

      await request(app, 'POST', '/api/security/generate', {});

      // Config should remain unchanged
      const configAfter = securityRepo.get();
      expect(configAfter.certificatePath).toEqual(configBefore.certificatePath);
      expect(configAfter.privateKeyConfigured).toEqual(configBefore.privateKeyConfigured);
    });
  });
});

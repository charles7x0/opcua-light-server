import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';
import { createSecurityRouter } from '../../src/api/routes/security.js';

/**
 * Feature: opcua-light-server, Property 8: Security Response Never Exposes Private Key Content
 *
 * For any security configuration (regardless of mode, certificate path, or key path),
 * the security GET endpoint response SHALL never contain the private key file contents
 * or any substring of the private key material.
 *
 * **Validates: Requirements 6.5**
 */

// --- Test App Setup ---

function createTestApp(securityRepo: SecurityRepository): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/security', createSecurityRouter(securityRepo));
  return app;
}

async function request(app: Express, method: string, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url: path,
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
      setHeader() { return this; },
      getHeader() { return undefined; },
      end() {
        resolve({ status: this.statusCode, body: undefined });
      },
    } as unknown as express.Response;

    app.handle(req as any, res as any, () => {
      resolve({ status: 404, body: { error: 'Not found' } });
    });
  });
}

// --- Arbitraries ---

const securityModeArb = fc.constantFrom('None' as const, 'Sign' as const, 'SignAndEncrypt' as const);

const certificatePathArb = fc.oneof(
  fc.stringMatching(/^\/[a-zA-Z0-9_/]{1,30}\.pem$/),
  fc.stringMatching(/^\/[a-zA-Z0-9_/]{1,30}\.der$/),
  fc.stringMatching(/^\/[a-zA-Z0-9_/]{1,30}\.crt$/),
  fc.stringMatching(/^C:\\[a-zA-Z0-9_\\]{1,30}\.cer$/),
);

const privateKeyPathArb = fc.oneof(
  fc.stringMatching(/^\/[a-zA-Z0-9_/]{1,30}\.pem$/),
  fc.stringMatching(/^\/[a-zA-Z0-9_/]{1,30}\.key$/),
  fc.stringMatching(/^\/[a-zA-Z0-9_/]{1,30}\.der$/),
  fc.stringMatching(/^C:\\[a-zA-Z0-9_\\]{1,30}\.key$/),
);

const securityConfigArb = fc.record({
  mode: securityModeArb,
  certificatePath: certificatePathArb,
  privateKeyPath: privateKeyPathArb,
}).filter((config) => config.certificatePath !== config.privateKeyPath);

// --- Property Tests ---

describe('Feature: opcua-light-server, Property 8: Security Response Never Exposes Private Key Content', () => {
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

  /**
   * Validates: Requirements 6.5
   *
   * For any security configuration with various certificate/key paths,
   * the GET /api/security response SHALL:
   * - Never contain the private key path value
   * - Never contain field names "privateKeyPath" or "private_key_path"
   * - Contain privateKeyConfigured: true when a key is configured
   */
  it('should never expose private key path or content in GET /api/security response', async () => {
    await fc.assert(
      fc.asyncProperty(securityConfigArb, async (config) => {
        // Store the security configuration via the repository
        securityRepo.updatePolicy(config.mode);
        securityRepo.updateCertificate(config.certificatePath, config.privateKeyPath);

        // Call the GET /api/security endpoint
        const res = await request(app, 'GET', '/api/security');

        expect(res.status).toBe(200);

        // Serialize the response to a JSON string for inspection
        const responseJson = JSON.stringify(res.body);

        // The response must NEVER contain the private key path value
        expect(responseJson).not.toContain(config.privateKeyPath);

        // The response must NEVER contain field names that reference private key paths
        expect(responseJson).not.toContain('privateKeyPath');
        expect(responseJson).not.toContain('private_key_path');

        // The response must NEVER contain any substring that looks like private key content
        expect(responseJson).not.toContain('-----BEGIN PRIVATE KEY-----');
        expect(responseJson).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
        expect(responseJson).not.toContain('-----BEGIN EC PRIVATE KEY-----');
        expect(responseJson).not.toContain('-----BEGIN ENCRYPTED PRIVATE KEY-----');

        // The response SHOULD contain privateKeyConfigured: true when a key is configured
        const body = res.body as Record<string, unknown>;
        expect(body.privateKeyConfigured).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

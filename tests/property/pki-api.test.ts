import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fc from 'fast-check';
import express from 'express';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuthMiddleware } from '../../src/auth/middleware.js';
import { createPkiRouter } from '../../src/api/routes/pki.js';
import { TofuManager } from '../../src/tofu-manager/index.js';
import type { AuthConfig } from '../../src/auth/config.js';

/**
 * Feature: tofu-client-certificate-trust, Property 13: Authentication Enforcement on Mutations
 *
 * Validates: Requirements 8.5, 8.7
 *
 * For any HTTP request with method POST or DELETE to a /api/pki/certificates/* endpoint
 * that does not include valid authentication credentials, the API SHALL return a 401
 * status code without performing the requested operation.
 */

// ─── Test Configuration ───────────────────────────────────────────────────────

const TEST_API_KEY = 'test-secret-key-for-pki-property';

const authConfig: AuthConfig = {
  mode: 'api-key',
  apiKeys: [TEST_API_KEY],
  jwtSecret: '',
};

const HEX_CHARS = '0123456789abcdef';

/** Generator for valid 40-char lowercase hex thumbprints */
const validThumbprintArb = fc
  .array(fc.nat({ max: 15 }), { minLength: 40, maxLength: 40 })
  .map((nums) => nums.map((n) => HEX_CHARS[n]).join(''));

/** Generator for mutation methods: POST reject, POST trust, DELETE */
type MutationEndpoint = { method: 'POST' | 'DELETE'; pathSuffix: string };

const mutationEndpointArb = (thumbprint: string): fc.Arbitrary<MutationEndpoint> =>
  fc.constantFrom(
    { method: 'POST' as const, pathSuffix: `/${thumbprint}/reject` },
    { method: 'POST' as const, pathSuffix: `/${thumbprint}/trust` },
    { method: 'DELETE' as const, pathSuffix: `/${thumbprint}` }
  );

/** Generator for invalid/missing credentials headers */
const invalidCredentialsArb = fc.oneof(
  // No credentials at all
  fc.constant({} as Record<string, string>),
  // Empty x-api-key
  fc.constant({ 'x-api-key': '' }),
  // Random invalid x-api-key (never matches the test key)
  fc.string({ minLength: 1, maxLength: 80 })
    .filter((s) => s !== TEST_API_KEY)
    .map((s) => ({ 'x-api-key': s })),
  // Authorization without Bearer prefix
  fc.string({ minLength: 1, maxLength: 50 }).map((s) => ({ authorization: s })),
  // Bearer with empty token
  fc.constant({ authorization: 'Bearer ' }),
  // Bearer with random string (not the valid API key)
  fc.string({ minLength: 1, maxLength: 80 })
    .filter((s) => s !== TEST_API_KEY)
    .map((s) => ({ authorization: `Bearer ${s}` }))
);

// ─── Helper: HTTP request to local server ─────────────────────────────────────

function makeRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: data });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Feature: tofu-client-certificate-trust, Property 13: Authentication Enforcement on Mutations', () => {
  let server: http.Server;
  let port: number;
  let tempBase: string;
  let tofuManager: TofuManager;

  /** Mock ProcessManager with minimal interface */
  const mockProcessManager = {
    getStatus: () => ({ state: 'stopped' as const }),
    writeToStdin: () => true,
  } as any;

  beforeAll(async () => {
    // Create temp PKI directory structure
    tempBase = join(tmpdir(), `tofu-prop13-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const pkiPath = join(tempBase, 'pki');
    mkdirSync(join(pkiPath, 'trusted'), { recursive: true });
    mkdirSync(join(pkiPath, 'rejected'), { recursive: true });

    // Write a sample certificate file so GET requests return data
    const sampleThumbprint = 'a'.repeat(40);
    writeFileSync(join(pkiPath, 'trusted', `${sampleThumbprint}.der`), Buffer.alloc(32));

    // Set up TofuManager
    tofuManager = new TofuManager(pkiPath, mockProcessManager);

    // Build Express app with auth middleware and PKI router
    const app = express();
    app.use(express.json());

    const authMiddleware = createAuthMiddleware(authConfig);
    app.use('/api', authMiddleware);
    app.use('/api/pki/certificates', createPkiRouter(tofuManager));

    // Start server on random port
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  /**
   * Validates: Requirements 8.5, 8.7
   *
   * For any HTTP request with method POST or DELETE to a /api/pki/certificates/* endpoint
   * that does not include valid authentication credentials, the API SHALL return a 401
   * status code without performing the requested operation.
   */
  it('should return 401 for any POST or DELETE request without valid authentication', async () => {
    await fc.assert(
      fc.asyncProperty(
        validThumbprintArb,
        invalidCredentialsArb,
        async (thumbprint, headers) => {
          // Pick a random mutation endpoint for this thumbprint
          const endpoints: MutationEndpoint[] = [
            { method: 'POST', pathSuffix: `/${thumbprint}/reject` },
            { method: 'POST', pathSuffix: `/${thumbprint}/trust` },
            { method: 'DELETE', pathSuffix: `/${thumbprint}` },
          ];

          for (const endpoint of endpoints) {
            const path = `/api/pki/certificates${endpoint.pathSuffix}`;
            const result = await makeRequest(port, endpoint.method, path, headers);

            // Must return 401 Unauthorized
            expect(result.statusCode).toBe(401);

            // Body should contain UNAUTHORIZED error
            if (result.body) {
              const body = JSON.parse(result.body);
              expect(body.error).toBeDefined();
              expect(body.error.code).toBe('UNAUTHORIZED');
              expect(typeof body.error.message).toBe('string');
              expect(body.error.message.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Validates: Requirements 8.6
   *
   * Verify that GET requests work WITHOUT authentication (returns 200).
   * This confirms authentication is only enforced on mutations.
   */
  it('should allow GET /api/pki/certificates without authentication', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidCredentialsArb,
        async (headers) => {
          const result = await makeRequest(port, 'GET', '/api/pki/certificates', headers);

          // GET should succeed (200) regardless of auth credentials
          expect(result.statusCode).toBe(200);

          // Response should be a JSON array
          const body = JSON.parse(result.body);
          expect(Array.isArray(body)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

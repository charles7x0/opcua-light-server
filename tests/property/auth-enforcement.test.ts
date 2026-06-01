import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from '../../src/auth/middleware.js';
import type { AuthConfig } from '../../src/auth/config.js';

/**
 * Feature: opcua-light-server
 * Property 9: Authentication Enforcement on Mutating Endpoints
 *
 * Validates: Requirements 11.1, 11.2, 11.3
 */

// Known valid credentials for testing (requests will NOT use these)
const VALID_API_KEYS = ['secret-key-alpha', 'secret-key-beta'];
const JWT_SECRET = 'test-jwt-secret-for-property-tests';
const JWT_ISSUER = 'opcua-light-server-test';

// Known API endpoint paths
const API_PATHS = [
  '/api/nodes',
  '/api/nodes/some-id',
  '/api/namespaces',
  '/api/namespaces/some-id',
  '/api/object-nodes',
  '/api/object-nodes/some-id',
  '/api/server/start',
  '/api/server/stop',
  '/api/server/reload',
  '/api/security/policy',
  '/api/security/certificate',
  '/api/s7/connections',
  '/api/s7/connections/some-id',
  '/api/s7/mappings',
  '/api/s7/mappings/some-id',
  '/api/s7/status',
];

// Mutating HTTP methods
const MUTATING_METHODS = ['POST', 'PUT', 'DELETE'] as const;

// Helper to create a mock request
function mockRequest(method: string, path: string, headers: Record<string, string> = {}): Request {
  return {
    method,
    path,
    headers,
  } as unknown as Request;
}

// Helper to create a mock response that tracks calls
function mockResponse(): Response & { statusCode: number; body: unknown; jsonCalled: boolean } {
  const res = {
    statusCode: 0,
    body: null as unknown,
    jsonCalled: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      res.jsonCalled = true;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; jsonCalled: boolean };
}

/**
 * Generator for invalid/missing credentials.
 * Produces headers that should NEVER authenticate successfully.
 */
function invalidCredentialsArb(): fc.Arbitrary<Record<string, string>> {
  return fc.oneof(
    // No credentials at all
    fc.constant({}),
    // Empty Authorization header
    fc.constant({ authorization: '' }),
    // Authorization without Bearer prefix
    fc.string({ minLength: 1, maxLength: 50 }).map((s) => ({ authorization: s })),
    // Bearer with empty token
    fc.constant({ authorization: 'Bearer ' }),
    // Bearer with random string (not a valid API key or JWT)
    fc.string({ minLength: 1, maxLength: 100 })
      .filter((s) => !VALID_API_KEYS.includes(s))
      .map((s) => ({ authorization: `Bearer ${s}` })),
    // X-API-Key with random invalid value
    fc.string({ minLength: 1, maxLength: 100 })
      .filter((s) => !VALID_API_KEYS.includes(s))
      .map((s) => ({ 'x-api-key': s })),
    // Empty X-API-Key
    fc.constant({ 'x-api-key': '' }),
    // JWT signed with wrong secret
    fc.string({ minLength: 5, maxLength: 30 })
      .filter((s) => s !== JWT_SECRET)
      .map((wrongSecret) => {
        const token = jwt.sign({ sub: 'attacker' }, wrongSecret, { expiresIn: '1h' });
        return { authorization: `Bearer ${token}` };
      }),
    // Expired JWT (even with correct secret)
    fc.constant((() => {
      const token = jwt.sign({ sub: 'user' }, JWT_SECRET, { expiresIn: '-1s' });
      return { authorization: `Bearer ${token}` };
    })()),
    // JWT with wrong issuer (when issuer validation is configured)
    fc.string({ minLength: 1, maxLength: 20 })
      .filter((s) => s !== JWT_ISSUER)
      .map((wrongIssuer) => {
        const token = jwt.sign({ sub: 'user' }, JWT_SECRET, {
          expiresIn: '1h',
          issuer: wrongIssuer,
        });
        return { authorization: `Bearer ${token}` };
      })
  );
}

describe('Feature: opcua-light-server, Property 9: Authentication Enforcement on Mutating Endpoints', () => {
  /**
   * Validates: Requirements 11.1, 11.2, 11.3
   *
   * For any mutating HTTP request (POST, PUT, DELETE) to any endpoint
   * without valid authentication credentials, the middleware SHALL return
   * a 401 response and next() SHALL NOT be called (system state unchanged).
   */
  it('should return 401 for any mutating request without valid credentials in API key mode', () => {
    const config: AuthConfig = {
      mode: 'api-key',
      apiKeys: VALID_API_KEYS,
      jwtSecret: '',
    };
    const middleware = createAuthMiddleware(config);

    fc.assert(
      fc.property(
        fc.constantFrom(...MUTATING_METHODS),
        fc.constantFrom(...API_PATHS),
        invalidCredentialsArb(),
        (method, path, headers) => {
          const req = mockRequest(method, path, headers);
          const res = mockResponse();
          let nextCalled = false;

          middleware(req, res as unknown as Response, () => {
            nextCalled = true;
          });

          // Must return 401
          expect(res.statusCode).toBe(401);

          // Must include UNAUTHORIZED error code
          expect(res.body).toBeDefined();
          const body = res.body as { error: { code: string; message: string } };
          expect(body.error).toBeDefined();
          expect(body.error.code).toBe('UNAUTHORIZED');
          expect(typeof body.error.message).toBe('string');
          expect(body.error.message.length).toBeGreaterThan(0);

          // next() must NOT be called (system state unchanged)
          expect(nextCalled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return 401 for any mutating request without valid credentials in JWT mode', () => {
    const config: AuthConfig = {
      mode: 'jwt',
      apiKeys: [],
      jwtSecret: JWT_SECRET,
      jwtIssuer: JWT_ISSUER,
    };
    const middleware = createAuthMiddleware(config);

    fc.assert(
      fc.property(
        fc.constantFrom(...MUTATING_METHODS),
        fc.constantFrom(...API_PATHS),
        invalidCredentialsArb(),
        (method, path, headers) => {
          const req = mockRequest(method, path, headers);
          const res = mockResponse();
          let nextCalled = false;

          middleware(req, res as unknown as Response, () => {
            nextCalled = true;
          });

          // Must return 401
          expect(res.statusCode).toBe(401);

          // Must include UNAUTHORIZED error code
          expect(res.body).toBeDefined();
          const body = res.body as { error: { code: string; message: string } };
          expect(body.error).toBeDefined();
          expect(body.error.code).toBe('UNAUTHORIZED');
          expect(typeof body.error.message).toBe('string');
          expect(body.error.message.length).toBeGreaterThan(0);

          // next() must NOT be called (system state unchanged)
          expect(nextCalled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

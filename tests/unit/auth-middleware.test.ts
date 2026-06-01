import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from '../../src/auth/middleware.js';
import type { AuthConfig } from '../../src/auth/config.js';

// Helper to create a mock request
function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    path: '/',
    ...overrides,
  } as unknown as Request;
}

// Helper to create a mock response
function mockResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('Auth Middleware', () => {
  const jwtSecret = 'test-secret-key';
  const validApiKey = 'valid-key-123';

  describe('API Key mode', () => {
    let config: AuthConfig;

    beforeEach(() => {
      config = {
        mode: 'api-key',
        apiKeys: [validApiKey, 'another-key'],
        jwtSecret: '',
      };
    });

    it('should allow GET requests without authentication', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should allow POST with valid API key in Authorization header', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${validApiKey}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should allow PUT with valid API key in X-API-Key header', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'PUT',
        headers: { 'x-api-key': validApiKey },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should allow DELETE with valid API key', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'DELETE',
        headers: { authorization: `Bearer ${validApiKey}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should return 401 for POST without credentials', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({ method: 'POST', headers: {} });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication credentials' },
      });
    });

    it('should return 401 for invalid API key', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
      });
    });

    it('should return 401 for empty Bearer token', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'DELETE',
        headers: { authorization: 'Bearer ' },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication credentials' },
      });
    });

    it('should return 401 for Authorization header without Bearer prefix', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: validApiKey },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication credentials' },
      });
    });
  });

  describe('JWT mode', () => {
    let config: AuthConfig;

    beforeEach(() => {
      config = {
        mode: 'jwt',
        apiKeys: [],
        jwtSecret,
      };
    });

    it('should allow GET requests without authentication', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({ method: 'GET' });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should allow POST with valid JWT token', () => {
      const token = jwt.sign({ sub: 'user1' }, jwtSecret, { expiresIn: '1h' });
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should allow PUT with valid JWT token', () => {
      const token = jwt.sign({ sub: 'user1' }, jwtSecret, { expiresIn: '1h' });
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should return 401 for missing token on POST', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({ method: 'POST', headers: {} });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication credentials' },
      });
    });

    it('should return 401 for expired JWT token', () => {
      const token = jwt.sign({ sub: 'user1' }, jwtSecret, { expiresIn: '-1s' });
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Token expired' },
      });
    });

    it('should return 401 for invalid JWT token', () => {
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'DELETE',
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
    });

    it('should return 401 for JWT signed with wrong secret', () => {
      const token = jwt.sign({ sub: 'user1' }, 'wrong-secret', { expiresIn: '1h' });
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
    });

    it('should validate JWT issuer when configured', () => {
      config.jwtIssuer = 'expected-issuer';
      const token = jwt.sign({ sub: 'user1' }, jwtSecret, {
        expiresIn: '1h',
        issuer: 'wrong-issuer',
      });
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
    });

    it('should accept JWT with correct issuer when configured', () => {
      config.jwtIssuer = 'expected-issuer';
      const token = jwt.sign({ sub: 'user1' }, jwtSecret, {
        expiresIn: '1h',
        issuer: 'expected-issuer',
      });
      const middleware = createAuthMiddleware(config);
      const req = mockRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      let nextCalled = false;

      middleware(req, res as unknown as Response, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  describe('loadAuthConfig', () => {
    it('should load config from environment variables', async () => {
      const originalEnv = { ...process.env };
      process.env.AUTH_MODE = 'jwt';
      process.env.API_KEYS = 'key1,key2,key3';
      process.env.JWT_SECRET = 'my-secret';
      process.env.JWT_ISSUER = 'my-issuer';

      const { loadAuthConfig } = await import('../../src/auth/config.js');
      const config = loadAuthConfig();

      expect(config.mode).toBe('jwt');
      expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
      expect(config.jwtSecret).toBe('my-secret');
      expect(config.jwtIssuer).toBe('my-issuer');

      // Restore env
      process.env = originalEnv;
    });
  });
});

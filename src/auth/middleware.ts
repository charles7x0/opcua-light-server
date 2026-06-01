/**
 * Authentication middleware for the Control API.
 * Validates API key or JWT on mutating endpoints (POST, PUT, DELETE).
 * Allows unauthenticated access to GET requests (read-only).
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthConfig } from './config.js';
import type { ErrorResponse } from '../types/api.js';

/**
 * Creates an Express middleware that enforces authentication
 * based on the provided AuthConfig.
 */
export function createAuthMiddleware(config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Allow all requests when auth is disabled
    if (config.mode === 'none') {
      next();
      return;
    }

    // Allow all GET requests (read-only) without authentication
    if (req.method === 'GET') {
      next();
      return;
    }

    // For mutating methods (POST, PUT, DELETE), require authentication
    if (config.mode === 'api-key') {
      validateApiKey(req, res, next, config);
    } else {
      validateJwt(req, res, next, config);
    }
  };
}

/**
 * Validates an API key from the Authorization header (Bearer) or X-API-Key header.
 */
function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
  config: AuthConfig
): void {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    sendUnauthorized(res, 'Missing authentication credentials');
    return;
  }

  if (!config.apiKeys.includes(apiKey)) {
    sendUnauthorized(res, 'Invalid API key');
    return;
  }

  next();
}

/**
 * Validates a JWT token from the Authorization header (Bearer).
 */
function validateJwt(
  req: Request,
  res: Response,
  next: NextFunction,
  config: AuthConfig
): void {
  const token = extractBearerToken(req);

  if (!token) {
    sendUnauthorized(res, 'Missing authentication credentials');
    return;
  }

  try {
    const verifyOptions: jwt.VerifyOptions = {};
    if (config.jwtIssuer) {
      verifyOptions.issuer = config.jwtIssuer;
    }

    jwt.verify(token, config.jwtSecret, verifyOptions);
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendUnauthorized(res, 'Token expired');
    } else {
      sendUnauthorized(res, 'Invalid token');
    }
  }
}

/**
 * Extracts an API key from the request.
 * Checks Authorization header (Bearer) first, then X-API-Key header.
 */
function extractApiKey(req: Request): string | null {
  const bearer = extractBearerToken(req);
  if (bearer) {
    return bearer;
  }

  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.length > 0) {
    return xApiKey;
  }

  return null;
}

/**
 * Extracts a Bearer token from the Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Sends a 401 Unauthorized response with the standard error format.
 */
function sendUnauthorized(res: Response, message: string): void {
  const body: ErrorResponse = {
    error: {
      code: 'UNAUTHORIZED',
      message,
    },
  };
  res.status(401).json(body);
}

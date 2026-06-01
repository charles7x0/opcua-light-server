/**
 * Authentication configuration for the Control API.
 * Supports API key and JWT authentication modes.
 */

/** Authentication mode. */
export type AuthMode = 'api-key' | 'jwt' | 'none';

/** Authentication configuration interface. */
export interface AuthConfig {
  mode: AuthMode;
  apiKeys: string[];
  jwtSecret: string;
  jwtIssuer?: string;
}

/**
 * Load authentication configuration from environment variables.
 *
 * Environment variables:
 * - AUTH_MODE: 'api-key' | 'jwt' | 'none' (default: 'none')
 * - API_KEYS: comma-separated list of valid API keys (required for api-key mode)
 * - JWT_SECRET: secret for JWT verification
 * - JWT_ISSUER: optional expected JWT issuer
 */
export function loadAuthConfig(): AuthConfig {
  const mode = (process.env.AUTH_MODE as AuthMode) || 'none';
  const apiKeys = process.env.API_KEYS
    ? process.env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
    : [];
  const jwtSecret = process.env.JWT_SECRET || '';
  const jwtIssuer = process.env.JWT_ISSUER || undefined;

  return { mode, apiKeys, jwtSecret, jwtIssuer };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { Database } from '../../src/db/database.js';
import { ConfigGenerator } from '../../src/config-generator/index.js';

/**
 * Feature: tofu-client-certificate-trust, Property 12: Config Generator PKI Path Inclusion
 *
 * Validates: Requirements 11.1, 11.2
 *
 * For any security configuration where mode is 'Sign' or 'SignAndEncrypt'
 * AND certificate and key paths are configured, the generated config JSON
 * SHALL contain pkiTrustedPath and pkiRejectedPath fields with absolute
 * filesystem paths. Conversely, for any configuration where mode is 'None',
 * the generated config JSON SHALL NOT contain these fields.
 */

describe('Feature: tofu-client-certificate-trust, Property 12: Config Generator PKI Path Inclusion', () => {
  let db: Database;
  let generator: ConfigGenerator;

  const pkiTrustedDir = resolve('data/pki/trusted');
  const pkiRejectedDir = resolve('data/pki/rejected');

  beforeEach(() => {
    db = new Database(':memory:');
    generator = new ConfigGenerator(db);

    // Ensure PKI directories exist for tests that require them
    mkdirSync(pkiTrustedDir, { recursive: true });
    mkdirSync(pkiRejectedDir, { recursive: true });
  });

  afterEach(() => {
    db.close();
  });

  /** Generator for valid security modes (Sign or SignAndEncrypt) */
  const secureModesArb = fc.constantFrom('Sign', 'SignAndEncrypt');

  /** Generator for random non-empty certificate path strings */
  const certPathArb = fc.stringOf(
    fc.constantFrom(
      ...'/abcdefghijklmnopqrstuvwxyz0123456789._-'.split('')
    ),
    { minLength: 5, maxLength: 80 }
  ).map((s) => '/' + s);

  /** Generator for random non-empty key path strings */
  const keyPathArb = fc.stringOf(
    fc.constantFrom(
      ...'/abcdefghijklmnopqrstuvwxyz0123456789._-'.split('')
    ),
    { minLength: 5, maxLength: 80 }
  ).map((s) => '/' + s);

  /**
   * Sub-property 1:
   * When mode is 'Sign' or 'SignAndEncrypt' with cert/key configured
   * AND PKI dirs exist → output has pkiTrustedPath and pkiRejectedPath as absolute paths.
   *
   * Validates: Requirements 11.1
   */
  it('should include pkiTrustedPath and pkiRejectedPath with absolute paths when mode is Sign or SignAndEncrypt', () => {
    fc.assert(
      fc.property(
        secureModesArb,
        certPathArb,
        keyPathArb,
        (mode, certPath, keyPath) => {
          const conn = db.getConnection();
          conn.prepare(
            `UPDATE security_config SET mode = ?, certificate_path = ?, private_key_path = ? WHERE id = 1`
          ).run(mode, certPath, keyPath);

          const config = generator.generate();

          expect(config.security.mode).toBe(mode);
          expect(config.security.pkiTrustedPath).toBeDefined();
          expect(config.security.pkiRejectedPath).toBeDefined();
          expect(isAbsolute(config.security.pkiTrustedPath!)).toBe(true);
          expect(isAbsolute(config.security.pkiRejectedPath!)).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Sub-property 2:
   * When mode is 'None' → output does NOT have pkiTrustedPath or pkiRejectedPath fields.
   *
   * Validates: Requirements 11.2
   */
  it('should NOT include pkiTrustedPath and pkiRejectedPath when mode is None', () => {
    fc.assert(
      fc.property(
        // Generate random cert/key paths (or none) — mode None should always omit PKI fields
        fc.option(certPathArb, { nil: undefined }),
        fc.option(keyPathArb, { nil: undefined }),
        (certPath, keyPath) => {
          const conn = db.getConnection();
          conn.prepare(
            `UPDATE security_config SET mode = 'None', certificate_path = ?, private_key_path = ? WHERE id = 1`
          ).run(certPath ?? null, keyPath ?? null);

          const config = generator.generate();

          expect(config.security.mode).toBe('None');
          expect(config.security.pkiTrustedPath).toBeUndefined();
          expect(config.security.pkiRejectedPath).toBeUndefined();
        }
      ),
      { numRuns: 20 }
    );
  });
});

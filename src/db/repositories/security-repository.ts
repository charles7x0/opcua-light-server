import { Database } from '../database.js';
import { SecurityConfig } from '../../types/index.js';
import { readCertificateExpiry } from '../../cert-generator/index.js';
import type { HttpsConfig } from '../../api/https-server.js';

interface SecurityConfigRow {
  id: number;
  mode: string;
  certificate_path: string | null;
  private_key_path: string | null;
  updated_at: string;
}

/**
 * Repository for managing OPC UA security configuration.
 * The security_config table has a single row with id=1.
 * Private key paths/contents are NEVER exposed in responses.
 */
export class SecurityRepository {
  constructor(private db: Database) {}

  /**
   * Get the current security configuration.
   * Returns mode, certificatePath, certificateValid (true when the certificate file exists,
   * is parseable, and has not expired), and a boolean indicating whether a private key is configured.
   * NEVER returns the actual private key path or contents.
   */
  get(): SecurityConfig {
    const results = this.db.readWithCache<SecurityConfigRow>(
      'security_config',
      (conn) =>
        conn
          .prepare('SELECT id, mode, certificate_path, private_key_path, updated_at FROM security_config WHERE id = 1')
          .all() as SecurityConfigRow[]
    );

    const row = results[0];
    if (!row) {
      return {
        mode: 'None',
        privateKeyConfigured: false,
      };
    }

    const expiryInfo = this.getCertificateExpiryInfo(row.certificate_path);

    // Certificate is valid if it has a configured path AND expiry info could be read
    // (readCertificateExpiry returns null if file is missing or cannot be parsed)
    // AND it has not expired (remainingDays > 0)
    const certificateValid = row.certificate_path != null
      && expiryInfo.certificateRemainingDays != null
      && expiryInfo.certificateRemainingDays > 0;

    return {
      mode: row.mode as SecurityConfig['mode'],
      certificatePath: row.certificate_path ?? undefined,
      certificateValid: row.certificate_path ? certificateValid : undefined,
      privateKeyConfigured: row.private_key_path !== null && row.private_key_path.length > 0,
      ...expiryInfo,
    };
  }

  /**
   * Read certificate expiry information if a certificate path is configured.
   */
  private getCertificateExpiryInfo(certPath: string | null | undefined): Pick<SecurityConfig, 'certificateExpiresAt' | 'certificateRemainingDays'> {
    if (!certPath) return {};

    const expiryInfo = readCertificateExpiry(certPath);
    if (!expiryInfo) return {};

    return {
      certificateExpiresAt: expiryInfo.expiresAt,
      certificateRemainingDays: expiryInfo.remainingDays,
    };
  }

  /**
   * Update the security mode (None, Sign, SignAndEncrypt).
   */
  updatePolicy(mode: SecurityConfig['mode']): SecurityConfig {
    const validModes: SecurityConfig['mode'][] = ['None', 'Sign', 'SignAndEncrypt'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid security mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
    }

    this.db.write((conn) =>
      conn
        .prepare("UPDATE security_config SET mode = ?, updated_at = datetime('now') WHERE id = 1")
        .run(mode)
    );

    // Invalidate cache after write
    this.db.updateCache('security_config', []);

    return this.get();
  }

  /**
   * Get the HTTPS configuration (cert and key paths) for server startup.
   * Returns null if either path is not configured.
   * This is an internal method — the private key path is NOT exposed via the public API.
   */
  getHttpsConfig(): HttpsConfig | null {
    const results = this.db.readWithCache<SecurityConfigRow>(
      'security_config',
      (conn) =>
        conn
          .prepare('SELECT id, mode, certificate_path, private_key_path, updated_at FROM security_config WHERE id = 1')
          .all() as SecurityConfigRow[]
    );

    const row = results[0];
    if (!row || !row.certificate_path || !row.private_key_path) {
      return null;
    }

    return {
      certPath: row.certificate_path,
      keyPath: row.private_key_path,
    };
  }

  /**
   * Get only the certificate file path from the security configuration.
   * Returns null if no certificate path is configured.
   * Does NOT expose private key path.
   */
  getCertificatePath(): string | null {
    const results = this.db.readWithCache<Pick<SecurityConfigRow, 'certificate_path'>>(
      'security_config',
      (conn) =>
        conn
          .prepare('SELECT certificate_path FROM security_config WHERE id = 1')
          .all() as Pick<SecurityConfigRow, 'certificate_path'>[]
    );

    const row = results[0];
    if (!row || !row.certificate_path) {
      return null;
    }

    return row.certificate_path;
  }

  /**
   * Update the certificate path and private key path.
   */
  updateCertificate(certificatePath: string, privateKeyPath: string): SecurityConfig {
    if (!certificatePath || certificatePath.trim().length === 0) {
      throw new Error('Certificate path is required');
    }
    if (!privateKeyPath || privateKeyPath.trim().length === 0) {
      throw new Error('Private key path is required');
    }

    this.db.write((conn) =>
      conn
        .prepare(
          "UPDATE security_config SET certificate_path = ?, private_key_path = ?, updated_at = datetime('now') WHERE id = 1"
        )
        .run(certificatePath, privateKeyPath)
    );

    // Invalidate cache after write
    this.db.updateCache('security_config', []);

    return this.get();
  }
}

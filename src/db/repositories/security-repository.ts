import { Database } from '../database.js';
import { SecurityConfig } from '../../types/index.js';

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
   * Returns mode, certificatePath, and a boolean indicating whether a private key is configured.
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

    return {
      mode: row.mode as SecurityConfig['mode'],
      certificatePath: row.certificate_path ?? undefined,
      privateKeyConfigured: row.private_key_path !== null && row.private_key_path.length > 0,
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

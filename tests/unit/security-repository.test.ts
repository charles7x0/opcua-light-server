import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';

describe('SecurityRepository', () => {
  let db: Database;
  let repo: SecurityRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new SecurityRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('get', () => {
    it('should return default security config with mode None', () => {
      const config = repo.get();

      expect(config.mode).toBe('None');
      expect(config.privateKeyConfigured).toBe(false);
      expect(config.certificatePath).toBeUndefined();
    });

    it('should never return private key path in response', () => {
      // Set a private key path directly in the database
      const conn = db.getConnection();
      conn
        .prepare(
          "UPDATE security_config SET private_key_path = '/secret/key.pem' WHERE id = 1"
        )
        .run();

      const config = repo.get();

      // Verify the response does not contain the private key path
      expect(config.privateKeyConfigured).toBe(true);
      expect(JSON.stringify(config)).not.toContain('/secret/key.pem');
      expect((config as Record<string, unknown>)['privateKeyPath']).toBeUndefined();
      expect((config as Record<string, unknown>)['private_key_path']).toBeUndefined();
    });

    it('should return certificatePath when configured', () => {
      const conn = db.getConnection();
      conn
        .prepare(
          "UPDATE security_config SET certificate_path = '/certs/server.pem' WHERE id = 1"
        )
        .run();

      const config = repo.get();

      expect(config.certificatePath).toBe('/certs/server.pem');
    });

    it('should indicate privateKeyConfigured as true when key path is set', () => {
      const conn = db.getConnection();
      conn
        .prepare(
          "UPDATE security_config SET private_key_path = '/keys/private.pem' WHERE id = 1"
        )
        .run();

      const config = repo.get();

      expect(config.privateKeyConfigured).toBe(true);
    });

    it('should indicate privateKeyConfigured as false when key path is empty string', () => {
      const conn = db.getConnection();
      conn
        .prepare("UPDATE security_config SET private_key_path = '' WHERE id = 1")
        .run();

      const config = repo.get();

      expect(config.privateKeyConfigured).toBe(false);
    });
  });

  describe('updatePolicy', () => {
    it('should update security mode to Sign', () => {
      const config = repo.updatePolicy('Sign');

      expect(config.mode).toBe('Sign');
    });

    it('should update security mode to SignAndEncrypt', () => {
      const config = repo.updatePolicy('SignAndEncrypt');

      expect(config.mode).toBe('SignAndEncrypt');
    });

    it('should update security mode back to None', () => {
      repo.updatePolicy('Sign');
      const config = repo.updatePolicy('None');

      expect(config.mode).toBe('None');
    });

    it('should persist the mode change in the database', () => {
      repo.updatePolicy('SignAndEncrypt');

      const conn = db.getConnection();
      const row = conn
        .prepare('SELECT mode FROM security_config WHERE id = 1')
        .get() as { mode: string };

      expect(row.mode).toBe('SignAndEncrypt');
    });

    it('should throw for invalid security mode', () => {
      expect(() => repo.updatePolicy('Invalid' as any)).toThrow(
        'Invalid security mode'
      );
    });

    it('should not expose private key in returned config', () => {
      const conn = db.getConnection();
      conn
        .prepare(
          "UPDATE security_config SET private_key_path = '/keys/private.pem' WHERE id = 1"
        )
        .run();

      const config = repo.updatePolicy('Sign');

      expect(config.privateKeyConfigured).toBe(true);
      expect(JSON.stringify(config)).not.toContain('/keys/private.pem');
    });
  });

  describe('updateCertificate', () => {
    it('should update certificate and private key paths', () => {
      const config = repo.updateCertificate(
        '/certs/server.pem',
        '/keys/private.pem'
      );

      expect(config.certificatePath).toBe('/certs/server.pem');
      expect(config.privateKeyConfigured).toBe(true);
    });

    it('should persist paths in the database', () => {
      repo.updateCertificate('/certs/server.pem', '/keys/private.pem');

      const conn = db.getConnection();
      const row = conn
        .prepare(
          'SELECT certificate_path, private_key_path FROM security_config WHERE id = 1'
        )
        .get() as { certificate_path: string; private_key_path: string };

      expect(row.certificate_path).toBe('/certs/server.pem');
      expect(row.private_key_path).toBe('/keys/private.pem');
    });

    it('should never return private key path in response', () => {
      const config = repo.updateCertificate(
        '/certs/server.pem',
        '/keys/super-secret.pem'
      );

      expect(JSON.stringify(config)).not.toContain('/keys/super-secret.pem');
      expect((config as Record<string, unknown>)['privateKeyPath']).toBeUndefined();
      expect((config as Record<string, unknown>)['private_key_path']).toBeUndefined();
    });

    it('should throw when certificate path is empty', () => {
      expect(() => repo.updateCertificate('', '/keys/private.pem')).toThrow(
        'Certificate path is required'
      );
    });

    it('should throw when private key path is empty', () => {
      expect(() =>
        repo.updateCertificate('/certs/server.pem', '')
      ).toThrow('Private key path is required');
    });

    it('should throw when certificate path is whitespace only', () => {
      expect(() =>
        repo.updateCertificate('   ', '/keys/private.pem')
      ).toThrow('Certificate path is required');
    });

    it('should throw when private key path is whitespace only', () => {
      expect(() =>
        repo.updateCertificate('/certs/server.pem', '   ')
      ).toThrow('Private key path is required');
    });
  });
});

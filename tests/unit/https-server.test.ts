import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shouldUseHttps, createHttpsServer } from '../../src/api/https-server.js';
import { generateCertificate } from '../../src/cert-generator/index.js';
import type { SecurityConfig } from '../../src/types/index.js';
import express from 'express';

describe('shouldUseHttps', () => {
  it('returns true for Sign mode with configured cert and private key', () => {
    const config: SecurityConfig = {
      mode: 'Sign',
      certificatePath: './data/certs/server.der',
      privateKeyConfigured: true,
    };
    expect(shouldUseHttps(config)).toBe(true);
  });

  it('returns true for SignAndEncrypt mode with configured cert and private key', () => {
    const config: SecurityConfig = {
      mode: 'SignAndEncrypt',
      certificatePath: './data/certs/server.der',
      privateKeyConfigured: true,
    };
    expect(shouldUseHttps(config)).toBe(true);
  });

  it('returns false for None mode even with cert and private key configured', () => {
    const config: SecurityConfig = {
      mode: 'None',
      certificatePath: './data/certs/server.der',
      privateKeyConfigured: true,
    };
    expect(shouldUseHttps(config)).toBe(false);
  });

  it('returns false for Sign mode without certificatePath', () => {
    const config: SecurityConfig = {
      mode: 'Sign',
      privateKeyConfigured: true,
    };
    expect(shouldUseHttps(config)).toBe(false);
  });

  it('returns false for Sign mode with empty certificatePath', () => {
    const config: SecurityConfig = {
      mode: 'Sign',
      certificatePath: '',
      privateKeyConfigured: true,
    };
    expect(shouldUseHttps(config)).toBe(false);
  });

  it('returns false for Sign mode with privateKeyConfigured=false', () => {
    const config: SecurityConfig = {
      mode: 'Sign',
      certificatePath: './data/certs/server.der',
      privateKeyConfigured: false,
    };
    expect(shouldUseHttps(config)).toBe(false);
  });

  it('returns false for SignAndEncrypt mode with empty certificatePath', () => {
    const config: SecurityConfig = {
      mode: 'SignAndEncrypt',
      certificatePath: '',
      privateKeyConfigured: true,
    };
    expect(shouldUseHttps(config)).toBe(false);
  });

  it('returns false for SignAndEncrypt mode with privateKeyConfigured=false', () => {
    const config: SecurityConfig = {
      mode: 'SignAndEncrypt',
      certificatePath: './data/certs/server.der',
      privateKeyConfigured: false,
    };
    expect(shouldUseHttps(config)).toBe(false);
  });
});

describe('createHttpsServer', () => {
  const TEST_DIR = join(tmpdir(), 'opcua-https-test-' + Date.now());
  const certPath = join(TEST_DIR, 'server.der');
  const keyPath = join(TEST_DIR, 'server.key');

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    generateCertificate(certPath, keyPath, {
      commonName: 'HTTPS Test Cert',
    });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('creates an https.Server with valid cert and key files', () => {
    const app = express();
    const server = createHttpsServer(app, { certPath, keyPath });

    expect(server).toBeDefined();
    expect(server.listening).toBe(false);
    // Verify it's an HTTPS server by checking for the expected methods
    expect(typeof server.listen).toBe('function');
    expect(typeof server.close).toBe('function');
  });

  it('throws when cert file does not exist', () => {
    const app = express();
    const nonexistentCert = join(TEST_DIR, 'nonexistent.der');

    expect(() => createHttpsServer(app, { certPath: nonexistentCert, keyPath })).toThrow();
  });

  it('throws when key file does not exist', () => {
    const app = express();
    const nonexistentKey = join(TEST_DIR, 'nonexistent.key');

    expect(() => createHttpsServer(app, { certPath, keyPath: nonexistentKey })).toThrow();
  });
});

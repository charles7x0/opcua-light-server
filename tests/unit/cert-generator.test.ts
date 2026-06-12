import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateCertificate, readCertificateExpiry } from '../../src/cert-generator/index.js';
import forge from 'node-forge';
import { writeFileSync } from 'fs';

const TEST_DIR = join(tmpdir(), 'opcua-cert-test-' + Date.now());

describe('readCertificateExpiry', () => {
  const certPath = join(TEST_DIR, 'test-cert.der');
  const keyPath = join(TEST_DIR, 'test-key.pem');

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Generate a valid certificate for tests
    generateCertificate(certPath, keyPath, {
      commonName: 'Test Certificate',
    });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('returns CertExpiryInfo for a valid DER certificate', () => {
    const result = readCertificateExpiry(certPath);
    expect(result).not.toBeNull();
    expect(result!.expiresAt).toBeDefined();
    expect(result!.createdAt).toBeDefined();
    expect(result!.remainingDays).toBeGreaterThan(0);
  });

  it('returns expiresAt as a valid ISO 8601 string', () => {
    const result = readCertificateExpiry(certPath);
    expect(result).not.toBeNull();
    // ISO 8601 format check
    const parsed = new Date(result!.expiresAt);
    expect(parsed.toISOString()).toBe(result!.expiresAt);
  });

  it('returns createdAt as a valid ISO 8601 string', () => {
    const result = readCertificateExpiry(certPath);
    expect(result).not.toBeNull();
    const parsed = new Date(result!.createdAt);
    expect(parsed.toISOString()).toBe(result!.createdAt);
  });

  it('returns remainingDays as a non-negative integer for a fresh certificate', () => {
    const result = readCertificateExpiry(certPath);
    expect(result).not.toBeNull();
    expect(Number.isInteger(result!.remainingDays)).toBe(true);
    expect(result!.remainingDays).toBeGreaterThanOrEqual(0);
    // Freshly generated cert with 1825 days validity
    expect(result!.remainingDays).toBeLessThanOrEqual(1825);
    expect(result!.remainingDays).toBeGreaterThanOrEqual(1824);
  });

  it('returns null when file does not exist', () => {
    const result = readCertificateExpiry(join(TEST_DIR, 'nonexistent.der'));
    expect(result).toBeNull();
  });

  it('returns null when file cannot be parsed (invalid content)', () => {
    const invalidPath = join(TEST_DIR, 'invalid.der');
    writeFileSync(invalidPath, 'this is not a valid certificate');
    const result = readCertificateExpiry(invalidPath);
    expect(result).toBeNull();
  });

  it('returns null for an empty file', () => {
    const emptyPath = join(TEST_DIR, 'empty.der');
    writeFileSync(emptyPath, '');
    const result = readCertificateExpiry(emptyPath);
    expect(result).toBeNull();
  });

  it('returns remainingDays: 0 for an expired certificate', () => {
    // Generate a certificate that is already expired
    const expiredCertPath = join(TEST_DIR, 'expired-cert.der');
    const expiredKeyPath = join(TEST_DIR, 'expired-key.pem');

    // Create an expired cert using node-forge directly
    const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keyPair.publicKey;
    cert.serialNumber = '01';

    // Set validity to the past (expired 30 days ago)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 60);
    cert.validity.notBefore = pastDate;

    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 30);
    cert.validity.notAfter = expiredDate;

    const attrs = [{ shortName: 'CN', value: 'Expired Test' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keyPair.privateKey, forge.md.sha256.create());

    // Write as DER
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const certBuffer = Buffer.from(certDer, 'binary');
    writeFileSync(expiredCertPath, certBuffer);
    writeFileSync(expiredKeyPath, forge.pki.privateKeyToPem(keyPair.privateKey));

    const result = readCertificateExpiry(expiredCertPath);
    expect(result).not.toBeNull();
    expect(result!.remainingDays).toBe(0);
    // expiresAt should still be a valid ISO string even for expired cert
    expect(new Date(result!.expiresAt).toISOString()).toBe(result!.expiresAt);
  });

  it('does not throw for any error condition', () => {
    // These should all return null gracefully, never throw
    expect(() => readCertificateExpiry('/nonexistent/path/cert.der')).not.toThrow();
    expect(() => readCertificateExpiry('')).not.toThrow();
  });
});

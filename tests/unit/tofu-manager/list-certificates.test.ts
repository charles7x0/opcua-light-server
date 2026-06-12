import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import forge from 'node-forge';
import { TofuManager } from '../../../src/tofu-manager/index.js';

/**
 * Creates a mock ProcessManager with the minimum interface needed by TofuManager.
 */
function createMockProcessManager() {
  return {
    getStatus: vi.fn().mockReturnValue({ state: 'stopped' }),
    writeToStdin: vi.fn().mockReturnValue(true),
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    onCrash: vi.fn(),
    updateConnectedClients: vi.fn(),
  } as any;
}

/**
 * Generate a self-signed DER certificate with the given CN and return as Buffer.
 */
function generateDerCertificate(options: {
  commonName?: string;
  issuerCN?: string;
  validityDays?: number;
} = {}): Buffer {
  const { commonName = 'Test Client', issuerCN, validityDays = 365 } = options;

  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = '01';

  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const subjectAttrs = [{ shortName: 'CN', value: commonName }];
  const issuerAttrs = issuerCN
    ? [{ shortName: 'CN', value: issuerCN }]
    : subjectAttrs;

  cert.setSubject(subjectAttrs);
  cert.setIssuer(issuerAttrs);
  cert.sign(keyPair.privateKey, forge.md.sha256.create());

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return Buffer.from(certDer, 'binary');
}

describe('TofuManager.listCertificates()', () => {
  let testDir: string;
  let pkiBase: string;
  let trustedDir: string;
  let rejectedDir: string;
  let processManager: ReturnType<typeof createMockProcessManager>;
  let manager: InstanceType<typeof TofuManager>;

  beforeEach(() => {
    testDir = join(tmpdir(), `tofu-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    pkiBase = join(testDir, 'pki');
    trustedDir = join(pkiBase, 'trusted');
    rejectedDir = join(pkiBase, 'rejected');
    mkdirSync(trustedDir, { recursive: true });
    mkdirSync(rejectedDir, { recursive: true });
    processManager = createMockProcessManager();
    manager = new TofuManager(pkiBase, processManager);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns an empty array when no certificates exist', () => {
    const result = manager.listCertificates();
    expect(result).toEqual([]);
  });

  it('returns certificates from the trusted directory with status "trusted"', () => {
    const certBuffer = generateDerCertificate({ commonName: 'Trusted Client' });
    const thumbprint = 'a'.repeat(40);
    writeFileSync(join(trustedDir, `${thumbprint}.der`), certBuffer);

    const result = manager.listCertificates();

    expect(result).toHaveLength(1);
    expect(result[0].thumbprint).toBe(thumbprint);
    expect(result[0].status).toBe('trusted');
    expect(result[0].subject).toBe('Trusted Client');
  });

  it('returns certificates from the rejected directory with status "rejected"', () => {
    const certBuffer = generateDerCertificate({ commonName: 'Rejected Client' });
    const thumbprint = 'b'.repeat(40);
    writeFileSync(join(rejectedDir, `${thumbprint}.der`), certBuffer);

    const result = manager.listCertificates();

    expect(result).toHaveLength(1);
    expect(result[0].thumbprint).toBe(thumbprint);
    expect(result[0].status).toBe('rejected');
    expect(result[0].subject).toBe('Rejected Client');
  });

  it('returns certificates from both stores combined', () => {
    const cert1 = generateDerCertificate({ commonName: 'Client A' });
    const cert2 = generateDerCertificate({ commonName: 'Client B' });
    writeFileSync(join(trustedDir, `${'a'.repeat(40)}.der`), cert1);
    writeFileSync(join(rejectedDir, `${'b'.repeat(40)}.der`), cert2);

    const result = manager.listCertificates();

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.status)).toContain('trusted');
    expect(result.map((c) => c.status)).toContain('rejected');
  });

  it('sorts certificates by thumbprint in ascending order', () => {
    const cert1 = generateDerCertificate({ commonName: 'Client Z' });
    const cert2 = generateDerCertificate({ commonName: 'Client A' });
    const cert3 = generateDerCertificate({ commonName: 'Client M' });

    writeFileSync(join(trustedDir, `${'c'.repeat(40)}.der`), cert1);
    writeFileSync(join(trustedDir, `${'a'.repeat(40)}.der`), cert2);
    writeFileSync(join(rejectedDir, `${'b'.repeat(40)}.der`), cert3);

    const result = manager.listCertificates();

    expect(result).toHaveLength(3);
    expect(result[0].thumbprint).toBe('a'.repeat(40));
    expect(result[1].thumbprint).toBe('b'.repeat(40));
    expect(result[2].thumbprint).toBe('c'.repeat(40));
  });

  it('extracts subject CN from the certificate', () => {
    const certBuffer = generateDerCertificate({ commonName: 'My OPC UA Client' });
    writeFileSync(join(trustedDir, `${'d'.repeat(40)}.der`), certBuffer);

    const result = manager.listCertificates();

    expect(result[0].subject).toBe('My OPC UA Client');
  });

  it('extracts issuer CN from the certificate', () => {
    const certBuffer = generateDerCertificate({
      commonName: 'Client',
      issuerCN: 'My CA Authority',
    });
    writeFileSync(join(trustedDir, `${'e'.repeat(40)}.der`), certBuffer);

    const result = manager.listCertificates();

    expect(result[0].issuer).toBe('My CA Authority');
  });

  it('includes notBefore and notAfter in ISO 8601 format', () => {
    const certBuffer = generateDerCertificate({ commonName: 'Client' });
    writeFileSync(join(trustedDir, `${'f'.repeat(40)}.der`), certBuffer);

    const result = manager.listCertificates();

    // Verify ISO 8601 format
    expect(() => new Date(result[0].notBefore)).not.toThrow();
    expect(() => new Date(result[0].notAfter)).not.toThrow();
    expect(new Date(result[0].notBefore).toISOString()).toBe(result[0].notBefore);
    expect(new Date(result[0].notAfter).toISOString()).toBe(result[0].notAfter);
  });

  it('includes fileSize matching the actual file size', () => {
    const certBuffer = generateDerCertificate({ commonName: 'Client' });
    const filePath = join(trustedDir, `${'0'.repeat(40)}.der`);
    writeFileSync(filePath, certBuffer);

    const result = manager.listCertificates();
    const expectedSize = statSync(filePath).size;

    expect(result[0].fileSize).toBe(expectedSize);
  });

  it('skips malformed certificate files and continues', () => {
    const validCert = generateDerCertificate({ commonName: 'Valid Client' });
    writeFileSync(join(trustedDir, `${'a'.repeat(40)}.der`), validCert);
    writeFileSync(join(trustedDir, `${'b'.repeat(40)}.der`), Buffer.from('not a certificate'));
    writeFileSync(join(trustedDir, `${'c'.repeat(40)}.der`), Buffer.alloc(0));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = manager.listCertificates();

    expect(result).toHaveLength(1);
    expect(result[0].thumbprint).toBe('a'.repeat(40));
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('only reads .der files and ignores other extensions', () => {
    const certBuffer = generateDerCertificate({ commonName: 'Client' });
    writeFileSync(join(trustedDir, `${'a'.repeat(40)}.der`), certBuffer);
    writeFileSync(join(trustedDir, 'readme.txt'), 'some text');
    writeFileSync(join(trustedDir, 'cert.pem'), 'pem data');

    const result = manager.listCertificates();

    expect(result).toHaveLength(1);
  });

  it('uses filename without .der extension as thumbprint', () => {
    const certBuffer = generateDerCertificate({ commonName: 'Client' });
    const thumbprint = 'abcdef0123456789abcdef0123456789abcdef01';
    writeFileSync(join(trustedDir, `${thumbprint}.der`), certBuffer);

    const result = manager.listCertificates();

    expect(result[0].thumbprint).toBe(thumbprint);
  });

  it('returns "Unknown" for subject CN when certificate has no CN', () => {
    // Generate a cert with empty CN to simulate missing CN
    const keyPair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keyPair.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    // Set subject with only O (no CN)
    cert.setSubject([{ shortName: 'O', value: 'Test Org' }]);
    cert.setIssuer([{ shortName: 'O', value: 'Test Org' }]);
    cert.sign(keyPair.privateKey, forge.md.sha256.create());

    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const certBuffer = Buffer.from(certDer, 'binary');

    writeFileSync(join(trustedDir, `${'1'.repeat(40)}.der`), certBuffer);

    const result = manager.listCertificates();

    expect(result[0].subject).toBe('Unknown');
    expect(result[0].issuer).toBe('Unknown');
  });
});

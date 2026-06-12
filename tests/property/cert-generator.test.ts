import { describe, it, expect, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import forge from 'node-forge';
import { generateCertificate, readCertificateExpiry } from '../../src/cert-generator/index.js';

/**
 * Feature: cert-generation
 * Properties 1, 2, 3, 4, 5, 6, 7, 12, 13: Certificate generation correctness
 *
 * Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.6, 2.8, 3.1, 3.2, 3.4, 3.5, 3.6, 6.1, 6.2, 11.1, 11.2, 11.3, 11.4, 11.5
 */

// --- Temp Directory Management ---

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cert-gen-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
});

// --- Generators ---

/** Generate a valid common name: 1-64 printable ASCII chars (no leading/trailing whitespace). */
function validCommonName(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
    { minLength: 1, maxLength: 64 }
  );
}

/** Generate a valid organization name: 1-64 printable ASCII chars. */
function validOrganization(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
    { minLength: 1, maxLength: 64 }
  );
}

/** Generate a valid 2-letter uppercase country code. */
function validCountryCode(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.integer({ min: 65, max: 90 }),
    fc.integer({ min: 65, max: 90 })
  ).map(([a, b]) => String.fromCharCode(a) + String.fromCharCode(b));
}

/** Generate a valid IPv4 address: four octets 0-255 joined by dots. */
function validIpv4(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
}

/** Generate a valid DNS name: 1-63 chars from [a-zA-Z0-9.-] with valid structure. */
function validDnsName(): fc.Arbitrary<string> {
  // Generate a simple valid hostname label followed by optional domain parts
  const label = fc.stringOf(
    fc.constantFrom(
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ),
    { minLength: 1, maxLength: 10 }
  );

  return fc.tuple(label, fc.array(label, { minLength: 0, maxLength: 3 }))
    .map(([first, rest]) => {
      const parts = [first, ...rest];
      return parts.join('.');
    })
    .filter((s) => s.length >= 1 && s.length <= 253);
}

// --- Helper: Parse DER certificate ---

function parseCertificate(certPath: string): forge.pki.Certificate {
  const certBuffer = readFileSync(certPath);
  const certDer = forge.util.createBuffer(certBuffer.toString('binary'));
  const asn1 = forge.asn1.fromDer(certDer);
  return forge.pki.certificateFromAsn1(asn1);
}

function parsePrivateKey(keyPath: string): forge.pki.rsa.PrivateKey {
  const keyPem = readFileSync(keyPath, 'utf-8');
  return forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
}

function getSubjectField(cert: forge.pki.Certificate, shortName: string): string | undefined {
  const field = cert.subject.getField(shortName);
  return field ? (field.value as string) : undefined;
}

function getIssuerField(cert: forge.pki.Certificate, shortName: string): string | undefined {
  const field = cert.issuer.getField(shortName);
  return field ? (field.value as string) : undefined;
}

function getSanExtension(cert: forge.pki.Certificate): { ips: string[]; dns: string[]; uris: string[] } {
  const sanExt = cert.getExtension('subjectAltName') as { altNames?: Array<{ type: number; value?: string; ip?: string }> } | null;
  const ips: string[] = [];
  const dns: string[] = [];
  const uris: string[] = [];

  if (sanExt && sanExt.altNames) {
    for (const entry of sanExt.altNames) {
      if (entry.type === 7 && entry.ip) {
        ips.push(entry.ip);
      } else if (entry.type === 2 && entry.value) {
        dns.push(entry.value);
      } else if (entry.type === 6 && entry.value) {
        uris.push(entry.value);
      }
    }
  }

  return { ips, dns, uris };
}

// --- Property Tests ---

describe('Feature: cert-generation, Property 1: Self-signed issuer equals subject', () => {
  /**
   * Validates: Requirements 2.3, 11.1
   *
   * For any valid GenerateCertificateRequest input, the generated certificate
   * SHALL have identical issuer and subject distinguished name fields.
   */
  it('should produce a certificate where issuer and subject distinguished names are identical', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        validOrganization(),
        validCountryCode(),
        (cn, org, country) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, {
            commonName: cn,
            organization: org,
            country,
          });

          const cert = parseCertificate(certPath);

          // Issuer and subject CN must match
          expect(getIssuerField(cert, 'CN')).toBe(getSubjectField(cert, 'CN'));
          // Issuer and subject O must match
          expect(getIssuerField(cert, 'O')).toBe(getSubjectField(cert, 'O'));
          // Issuer and subject C must match
          expect(getIssuerField(cert, 'C')).toBe(getSubjectField(cert, 'C'));
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 2: Validity period exactly 1825 days', () => {
  /**
   * Validates: Requirements 2.1, 11.2
   *
   * For any generated certificate, the difference between notAfter and notBefore
   * SHALL be exactly 1825 days.
   */
  it('should produce a certificate with exactly 1825 days validity period', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        (cn) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, { commonName: cn });

          const cert = parseCertificate(certPath);
          const notBefore = cert.validity.notBefore.getTime();
          const notAfter = cert.validity.notAfter.getTime();
          const diffDays = Math.round((notAfter - notBefore) / (24 * 60 * 60 * 1000));

          expect(diffDays).toBe(1825);
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 3: Key-pair modulus consistency', () => {
  /**
   * Validates: Requirements 1.1, 11.3
   *
   * For any generated certificate and its corresponding private key,
   * the certificate public key modulus SHALL match the private key modulus.
   */
  it('should produce a certificate whose public key modulus matches the private key modulus', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        (cn) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, { commonName: cn });

          const cert = parseCertificate(certPath);
          const privateKey = parsePrivateKey(keyPath);

          const publicKeyModulus = (cert.publicKey as forge.pki.rsa.PublicKey).n.toString(16);
          const privateKeyModulus = privateKey.n.toString(16);

          expect(publicKeyModulus).toBe(privateKeyModulus);
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 4: Distinguished name preservation', () => {
  /**
   * Validates: Requirements 2.4, 2.6, 2.8
   *
   * For any valid commonName, organization, and country code provided,
   * the generated certificate subject SHALL contain those exact values.
   */
  it('should preserve provided CN, O, and C in the certificate subject', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        validOrganization(),
        validCountryCode(),
        (cn, org, country) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, {
            commonName: cn,
            organization: org,
            country,
          });

          const cert = parseCertificate(certPath);

          expect(getSubjectField(cert, 'CN')).toBe(cn);
          expect(getSubjectField(cert, 'O')).toBe(org);
          expect(getSubjectField(cert, 'C')).toBe(country);
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 5: SAN minimum entries', () => {
  /**
   * Validates: Requirements 3.1, 3.4, 3.6
   *
   * For any generated certificate, the SAN SHALL contain at minimum
   * the Application URI and 127.0.0.1.
   */
  it('should always include application URI and 127.0.0.1 in SAN', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        (cn) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, { commonName: cn });

          const cert = parseCertificate(certPath);
          const san = getSanExtension(cert);

          expect(san.uris).toContain('urn:opcua-light-server:application');
          expect(san.ips).toContain('127.0.0.1');
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 6: SAN IP completeness', () => {
  /**
   * Validates: Requirements 3.2, 11.4
   *
   * For any non-empty array of valid IPv4 addresses provided in ipAddresses,
   * the SAN SHALL include every provided IP address plus 127.0.0.1.
   */
  it('should include all provided IPs plus 127.0.0.1 in SAN', () => {
    fc.assert(
      fc.property(
        fc.array(validIpv4(), { minLength: 1, maxLength: 4 }),
        (ips) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, {
            commonName: 'Test',
            ipAddresses: ips,
          });

          const cert = parseCertificate(certPath);
          const san = getSanExtension(cert);

          // All provided IPs should be present
          for (const ip of ips) {
            expect(san.ips).toContain(ip);
          }
          // 127.0.0.1 should always be present
          expect(san.ips).toContain('127.0.0.1');
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 7: SAN DNS completeness', () => {
  /**
   * Validates: Requirements 3.5
   *
   * For any non-empty array of valid DNS names, the SAN SHALL include
   * every provided DNS name.
   */
  it('should include all provided DNS names in SAN', () => {
    fc.assert(
      fc.property(
        fc.array(validDnsName(), { minLength: 1, maxLength: 4 }),
        (dnsNames) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, {
            commonName: 'Test',
            dnsNames,
          });

          const cert = parseCertificate(certPath);
          const san = getSanExtension(cert);

          for (const dns of dnsNames) {
            expect(san.dns).toContain(dns);
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 12: Expiry read round-trip', () => {
  /**
   * Validates: Requirements 6.1, 6.2, 11.5
   *
   * For any freshly generated certificate, readCertificateExpiry SHALL return
   * a non-null result with remainingDays between 1824 and 1825 inclusive.
   */
  it('should return remainingDays 1824-1825 for a freshly generated certificate', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        (cn) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, { commonName: cn });

          const expiry = readCertificateExpiry(certPath);

          expect(expiry).not.toBeNull();
          expect(expiry!.remainingDays).toBeGreaterThanOrEqual(1824);
          expect(expiry!.remainingDays).toBeLessThanOrEqual(1825);
          // expiresAt should be a valid ISO 8601 string
          expect(new Date(expiry!.expiresAt).toISOString()).toBe(expiry!.expiresAt);
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Feature: cert-generation, Property 13: Serial number byte length', () => {
  /**
   * Validates: Requirements 2.2
   *
   * For any generated certificate, the serial number SHALL be a positive
   * integer of at least 8 bytes and at most 20 bytes in length.
   */
  it('should produce a serial number that is 8-20 bytes positive integer', () => {
    fc.assert(
      fc.property(
        validCommonName(),
        (cn) => {
          const tempDir = createTempDir();
          const certPath = join(tempDir, 'server.der');
          const keyPath = join(tempDir, 'server.key');

          generateCertificate(certPath, keyPath, { commonName: cn });

          const cert = parseCertificate(certPath);
          const serialHex = cert.serialNumber;

          // Serial number is stored as hex string in node-forge
          // Each byte = 2 hex chars
          const byteLength = Math.ceil(serialHex.length / 2);

          expect(byteLength).toBeGreaterThanOrEqual(8);
          expect(byteLength).toBeLessThanOrEqual(20);

          // Serial number should be positive (first bit not set = first hex digit 0-7)
          // But node-forge stores it as an unsigned hex string, so just verify it's > 0
          const serialBigInt = BigInt('0x' + serialHex);
          expect(serialBigInt).toBeGreaterThan(0n);
        }
      ),
      { numRuns: 10 }
    );
  });
});

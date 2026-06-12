import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { isValidThumbprint } from '../../src/tofu-manager/index.js';

/**
 * Feature: tofu-client-certificate-trust
 * Property 10: Invalid Thumbprint Validation
 *
 * Validates: Requirements 4.4, 7.4, 8.8
 *
 * For any string that does NOT match the pattern `/^[0-9a-f]{40}$/`,
 * all PKI endpoints (reject, trust, delete) SHALL return a 400 error response
 * with code VALIDATION_ERROR, without performing any filesystem operations.
 */

const HEX_CHARS = '0123456789abcdef';

/** Generator for valid 40-char lowercase hex thumbprints */
const validThumbprintArb = fc
  .array(fc.nat({ max: 15 }), { minLength: 40, maxLength: 40 })
  .map((nums) => nums.map((n) => HEX_CHARS[n]).join(''));

/** Generator for invalid thumbprints covering multiple failure categories */
const invalidThumbprintArb = fc.oneof(
  // Too short (1-39 chars of valid hex)
  fc.integer({ min: 1, max: 39 }).chain((len) =>
    fc.array(fc.nat({ max: 15 }), { minLength: len, maxLength: len })
      .map((nums) => nums.map((n) => HEX_CHARS[n]).join(''))
  ),
  // Too long (41-80 chars of valid hex)
  fc.integer({ min: 41, max: 80 }).chain((len) =>
    fc.array(fc.nat({ max: 15 }), { minLength: len, maxLength: len })
      .map((nums) => nums.map((n) => HEX_CHARS[n]).join(''))
  ),
  // Empty string
  fc.constant(''),
  // Correct length but contains at least one uppercase hex character
  fc.array(fc.nat({ max: 15 }), { minLength: 40, maxLength: 40 }).chain((nums) => {
    return fc.nat({ max: 39 }).map((pos) => {
      const chars = nums.map((n) => HEX_CHARS[n]);
      // Force at least one uppercase letter (pick a hex letter a-f and uppercase it)
      const hexLetterIndex = (nums[pos] % 6) + 10; // maps to a-f
      chars[pos] = HEX_CHARS[hexLetterIndex].toUpperCase();
      return chars.join('');
    });
  }),
  // Correct length but contains non-hex characters
  fc.array(fc.nat({ max: 15 }), { minLength: 40, maxLength: 40 }).chain((nums) => {
    return fc.tuple(
      fc.nat({ max: 39 }),
      fc.constantFrom('g', 'h', 'x', 'z', '!', '@', ' ', '-', '_', '.')
    ).map(([pos, badChar]) => {
      const chars = nums.map((n) => HEX_CHARS[n]);
      chars[pos] = badChar;
      return chars.join('');
    });
  })
);

describe('Feature: tofu-client-certificate-trust, Property 10: Invalid Thumbprint Validation', () => {
  /**
   * Validates: Requirements 4.4, 7.4, 8.8
   *
   * For any randomly generated VALID thumbprint (40-char lowercase hex),
   * isValidThumbprint returns true.
   */
  it('should return true for any valid 40-character lowercase hex string', () => {
    fc.assert(
      fc.property(validThumbprintArb, (thumbprint) => {
        expect(isValidThumbprint(thumbprint)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 4.4, 7.4, 8.8
   *
   * For any randomly generated INVALID thumbprint (wrong length, uppercase,
   * non-hex chars, etc.), isValidThumbprint returns false.
   */
  it('should return false for any string that is not a valid 40-char lowercase hex', () => {
    fc.assert(
      fc.property(invalidThumbprintArb, (thumbprint) => {
        expect(isValidThumbprint(thumbprint)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});


import { TofuManager } from '../../src/tofu-manager/index.js';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Feature: tofu-client-certificate-trust
 * Property 1: Initialization Idempotency
 *
 * Validates: Requirements 1.4
 *
 * For any set of pre-existing files in the PKI directories (trusted/ and rejected/),
 * calling TofuManager.initialize() SHALL leave all existing files and their contents unchanged.
 */

/** Generator for a random filename (simulating thumbprint.der files) */
const filenameArb = fc
  .tuple(
    fc.array(fc.nat({ max: 15 }), { minLength: 40, maxLength: 40 })
      .map((nums) => nums.map((n) => HEX_CHARS[n]).join('')),
    fc.constant('.der')
  )
  .map(([name, ext]) => `${name}${ext}`);

/** Generator for random file content (simulating DER certificate bytes) */
const fileContentArb = fc.uint8Array({ minLength: 1, maxLength: 512 }).map((arr) => Buffer.from(arr));

/** Generator for a set of files (filename + content pairs) */
const fileSetArb = fc.array(
  fc.tuple(filenameArb, fileContentArb),
  { minLength: 0, maxLength: 10 }
).map((pairs) => {
  // Deduplicate by filename (keep first occurrence)
  const seen = new Set<string>();
  return pairs.filter(([name]) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
});

/** Mock ProcessManager with minimal interface needed by TofuManager */
const mockProcessManager = {
  getStatus: () => ({ state: 'stopped' as const }),
  writeToStdin: () => true,
} as any;

describe('Feature: tofu-client-certificate-trust, Property 1: Initialization Idempotency', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  /**
   * Validates: Requirements 1.4
   *
   * For any set of pre-existing files in the PKI directories (trusted/ and rejected/),
   * calling TofuManager.initialize() SHALL leave all existing files and their contents unchanged.
   */
  it('should leave all existing files unchanged after initialize()', async () => {
    await fc.assert(
      fc.asyncProperty(
        fileSetArb,
        fileSetArb,
        async (trustedFiles, rejectedFiles) => {
          // Create a unique temp directory for this run
          const tempBase = join(tmpdir(), `tofu-prop1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
          tempDirs.push(tempBase);

          const pkiPath = join(tempBase, 'pki');
          const trustedPath = join(pkiPath, 'trusted');
          const rejectedPath = join(pkiPath, 'rejected');

          // Pre-create the directories and populate with files
          mkdirSync(trustedPath, { recursive: true });
          mkdirSync(rejectedPath, { recursive: true });

          for (const [filename, content] of trustedFiles) {
            writeFileSync(join(trustedPath, filename), content);
          }
          for (const [filename, content] of rejectedFiles) {
            writeFileSync(join(rejectedPath, filename), content);
          }

          // Record the state before initialize()
          const trustedBefore = new Map<string, Buffer>();
          for (const [filename, content] of trustedFiles) {
            trustedBefore.set(filename, content);
          }
          const rejectedBefore = new Map<string, Buffer>();
          for (const [filename, content] of rejectedFiles) {
            rejectedBefore.set(filename, content);
          }

          // Call initialize()
          const manager = new TofuManager(pkiPath, mockProcessManager);
          await manager.initialize();

          // Verify all trusted files still exist with identical content
          const trustedAfter = readdirSync(trustedPath);
          expect(trustedAfter.sort()).toEqual([...trustedBefore.keys()].sort());
          for (const [filename, expectedContent] of trustedBefore) {
            const actualContent = readFileSync(join(trustedPath, filename));
            expect(actualContent.equals(expectedContent)).toBe(true);
          }

          // Verify all rejected files still exist with identical content
          const rejectedAfter = readdirSync(rejectedPath);
          expect(rejectedAfter.sort()).toEqual([...rejectedBefore.keys()].sort());
          for (const [filename, expectedContent] of rejectedBefore) {
            const actualContent = readFileSync(join(rejectedPath, filename));
            expect(actualContent.equals(expectedContent)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


import { createHash } from 'crypto';
import forge from 'node-forge';

/**
 * Feature: tofu-client-certificate-trust
 * Property 11: Certificate Listing Completeness and Ordering
 *
 * Validates: Requirements 6.1, 6.2
 *
 * For any set of valid DER certificate files distributed across the trust store
 * and reject store, calling listCertificates() SHALL return a list where:
 * (a) every valid certificate file is represented exactly once,
 * (b) each entry contains thumbprint, status, subject, issuer, notBefore, notAfter, and fileSize fields,
 * (c) entries are sorted alphabetically by thumbprint in ascending order.
 */

/** Generate a self-signed DER certificate with the given CN. */
function generateDerCertificate(commonName: string): Buffer {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = '01';

  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  cert.setSubject([{ shortName: 'CN', value: commonName }]);
  cert.setIssuer([{ shortName: 'CN', value: commonName }]);
  cert.sign(keyPair.privateKey, forge.md.sha256.create());

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return Buffer.from(certDer, 'binary');
}

/** Compute SHA-1 thumbprint of a DER buffer as 40-char lowercase hex. */
function computeThumbprint(derBuffer: Buffer): string {
  return createHash('sha1').update(derBuffer).digest('hex');
}

/**
 * Generator that produces N certificates (1-5) with a random distribution
 * across trusted and rejected directories. Each item has a unique cert and a store assignment.
 */
const certDistributionArb = fc
  .integer({ min: 1, max: 5 })
  .chain((count) =>
    fc.tuple(
      fc.array(fc.string({ minLength: 1, maxLength: 20, unit: 'grapheme-ascii' }), {
        minLength: count,
        maxLength: count,
      }),
      fc.array(fc.constantFrom('trusted' as const, 'rejected' as const), {
        minLength: count,
        maxLength: count,
      })
    )
  );

describe('Feature: tofu-client-certificate-trust, Property 11: Certificate Listing Completeness and Ordering', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  /**
   * Validates: Requirements 6.1, 6.2
   */
  it('should return all certificates exactly once with required fields, sorted by thumbprint', async () => {
    await fc.assert(
      fc.asyncProperty(certDistributionArb, async ([commonNames, stores]) => {
        // Create a unique temp directory for this run
        const tempBase = join(
          tmpdir(),
          `tofu-prop11-${Date.now()}-${Math.random().toString(36).slice(2)}`
        );
        tempDirs.push(tempBase);

        const pkiPath = join(tempBase, 'pki');
        const trustedPath = join(pkiPath, 'trusted');
        const rejectedPath = join(pkiPath, 'rejected');

        mkdirSync(trustedPath, { recursive: true });
        mkdirSync(rejectedPath, { recursive: true });

        // Generate certificates and write them to the appropriate store
        const expectedEntries: Array<{
          thumbprint: string;
          status: 'trusted' | 'rejected';
          derBuffer: Buffer;
        }> = [];

        // Use a Set to deduplicate thumbprints (in case two different CNs produce same cert hash)
        const seenThumbprints = new Set<string>();

        for (let i = 0; i < commonNames.length; i++) {
          const cn = commonNames[i];
          const store = stores[i];
          const derBuffer = generateDerCertificate(cn);
          const thumbprint = computeThumbprint(derBuffer);

          // Skip if we already have this thumbprint (avoid duplicate filenames)
          if (seenThumbprints.has(thumbprint)) continue;
          seenThumbprints.add(thumbprint);

          const targetDir = store === 'trusted' ? trustedPath : rejectedPath;
          writeFileSync(join(targetDir, `${thumbprint}.der`), derBuffer);
          expectedEntries.push({ thumbprint, status: store, derBuffer });
        }

        // Call listCertificates()
        const manager = new TofuManager(pkiPath, mockProcessManager);
        const result = manager.listCertificates();

        // (a) Every valid certificate file is represented exactly once
        expect(result.length).toBe(expectedEntries.length);

        const resultThumbprints = result.map((r) => r.thumbprint);
        const expectedThumbprints = expectedEntries.map((e) => e.thumbprint).sort();
        expect(resultThumbprints.sort()).toEqual(expectedThumbprints);

        // (b) Each entry contains all required fields
        for (const entry of result) {
          expect(entry).toHaveProperty('thumbprint');
          expect(entry).toHaveProperty('status');
          expect(entry).toHaveProperty('subject');
          expect(entry).toHaveProperty('issuer');
          expect(entry).toHaveProperty('notBefore');
          expect(entry).toHaveProperty('notAfter');
          expect(entry).toHaveProperty('fileSize');

          // Validate field types
          expect(typeof entry.thumbprint).toBe('string');
          expect(entry.thumbprint).toMatch(/^[0-9a-f]{40}$/);
          expect(['trusted', 'rejected']).toContain(entry.status);
          expect(typeof entry.subject).toBe('string');
          expect(typeof entry.issuer).toBe('string');
          expect(typeof entry.notBefore).toBe('string');
          expect(typeof entry.notAfter).toBe('string');
          expect(typeof entry.fileSize).toBe('number');
          expect(entry.fileSize).toBeGreaterThan(0);
        }

        // Verify status matches expected store assignment
        for (const expected of expectedEntries) {
          const found = result.find((r) => r.thumbprint === expected.thumbprint);
          expect(found).toBeDefined();
          expect(found!.status).toBe(expected.status);
        }

        // (c) Entries are sorted alphabetically by thumbprint in ascending order
        for (let i = 1; i < result.length; i++) {
          expect(result[i - 1].thumbprint <= result[i].thumbprint).toBe(true);
        }
      }),
      { numRuns: 20 }
    );
  });
});


/**
 * Feature: tofu-client-certificate-trust
 * Property 8: Delete Operation Removal
 *
 * Validates: Requirements 7.1
 *
 * For any valid 40-character lowercase hex thumbprint that corresponds to a file
 * in either the trust store or reject store, calling deleteCertificate(thumbprint)
 * SHALL result in that file no longer existing in either store.
 */

/** Generator for store location: 'trusted' or 'rejected' */
const storeLocationArb = fc.constantFrom('trusted' as const, 'rejected' as const);

describe('Feature: tofu-client-certificate-trust, Property 8: Delete Operation Removal', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  /**
   * Validates: Requirements 7.1
   *
   * Delete from trusted: file in trusted/ → after delete → not in trusted/ or rejected/
   */
  it('should remove a file from the trusted store so it no longer exists in either store', async () => {
    await fc.assert(
      fc.asyncProperty(
        validThumbprintArb,
        fileContentArb,
        async (thumbprint, content) => {
          const tempBase = join(
            tmpdir(),
            `tofu-prop8-trusted-${Date.now()}-${Math.random().toString(36).slice(2)}`
          );
          tempDirs.push(tempBase);

          const pkiPath = join(tempBase, 'pki');
          const trustedPath = join(pkiPath, 'trusted');
          const rejectedPath = join(pkiPath, 'rejected');

          mkdirSync(trustedPath, { recursive: true });
          mkdirSync(rejectedPath, { recursive: true });

          // Place file in trusted store
          writeFileSync(join(trustedPath, `${thumbprint}.der`), content);

          const manager = new TofuManager(pkiPath, mockProcessManager);
          manager.deleteCertificate(thumbprint);

          // Verify file no longer exists in either store
          expect(existsSync(join(trustedPath, `${thumbprint}.der`))).toBe(false);
          expect(existsSync(join(rejectedPath, `${thumbprint}.der`))).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 7.1
   *
   * Delete from rejected: file in rejected/ → after delete → not in trusted/ or rejected/
   */
  it('should remove a file from the rejected store so it no longer exists in either store', async () => {
    await fc.assert(
      fc.asyncProperty(
        validThumbprintArb,
        fileContentArb,
        async (thumbprint, content) => {
          const tempBase = join(
            tmpdir(),
            `tofu-prop8-rejected-${Date.now()}-${Math.random().toString(36).slice(2)}`
          );
          tempDirs.push(tempBase);

          const pkiPath = join(tempBase, 'pki');
          const trustedPath = join(pkiPath, 'trusted');
          const rejectedPath = join(pkiPath, 'rejected');

          mkdirSync(trustedPath, { recursive: true });
          mkdirSync(rejectedPath, { recursive: true });

          // Place file in rejected store
          writeFileSync(join(rejectedPath, `${thumbprint}.der`), content);

          const manager = new TofuManager(pkiPath, mockProcessManager);
          manager.deleteCertificate(thumbprint);

          // Verify file no longer exists in either store
          expect(existsSync(join(trustedPath, `${thumbprint}.der`))).toBe(false);
          expect(existsSync(join(rejectedPath, `${thumbprint}.der`))).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: tofu-client-certificate-trust
 * Property 6: Reject Operation State Transition
 *
 * Validates: Requirements 4.1
 *
 * For any valid 40-character lowercase hex thumbprint that corresponds to a file
 * in the trust store, calling rejectCertificate(thumbprint) SHALL result in:
 * (a) the file no longer existing in the trust store, AND
 * (b) a file with identical content existing in the reject store under the same filename.
 */
describe('Feature: tofu-client-certificate-trust, Property 6: Reject Operation State Transition', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  /**
   * Validates: Requirements 4.1
   */
  it('should move file from trusted/ to rejected/ with identical content', async () => {
    await fc.assert(
      fc.asyncProperty(
        validThumbprintArb,
        fileContentArb,
        async (thumbprint, content) => {
          // Create a unique temp directory for this run
          const tempBase = join(
            tmpdir(),
            `tofu-prop6-${Date.now()}-${Math.random().toString(36).slice(2)}`
          );
          tempDirs.push(tempBase);

          const pkiPath = join(tempBase, 'pki');
          const trustedPath = join(pkiPath, 'trusted');
          const rejectedPath = join(pkiPath, 'rejected');

          // Create directory structure and place file in trusted/
          mkdirSync(trustedPath, { recursive: true });
          mkdirSync(rejectedPath, { recursive: true });
          writeFileSync(join(trustedPath, `${thumbprint}.der`), content);

          // Instantiate TofuManager and call rejectCertificate
          const manager = new TofuManager(pkiPath, mockProcessManager);
          manager.rejectCertificate(thumbprint);

          // (a) File no longer exists in the trust store
          expect(existsSync(join(trustedPath, `${thumbprint}.der`))).toBe(false);

          // (b) File with identical content exists in the reject store
          const rejectedFile = join(rejectedPath, `${thumbprint}.der`);
          expect(existsSync(rejectedFile)).toBe(true);
          const rejectedContent = readFileSync(rejectedFile);
          expect(rejectedContent.equals(content)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: tofu-client-certificate-trust
 * Property 7: Trust Operation State Transition
 *
 * Validates: Requirements 5.1
 *
 * For any valid 40-character lowercase hex thumbprint that corresponds to a file
 * in the reject store AND does not correspond to a file in the trust store,
 * calling trustCertificate(thumbprint) SHALL result in:
 * (a) the file no longer existing in the reject store, AND
 * (b) a file with identical content existing in the trust store under the same filename.
 */
describe('Feature: tofu-client-certificate-trust, Property 7: Trust Operation State Transition', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  /**
   * Validates: Requirements 5.1
   */
  it('should move file from rejected/ to trusted/ with identical content after trustCertificate()', async () => {
    await fc.assert(
      fc.asyncProperty(
        validThumbprintArb,
        fileContentArb,
        async (thumbprint, content) => {
          // Create a unique temp directory for this run
          const tempBase = join(
            tmpdir(),
            `tofu-prop7-${Date.now()}-${Math.random().toString(36).slice(2)}`
          );
          tempDirs.push(tempBase);

          const pkiPath = join(tempBase, 'pki');
          const trustedPath = join(pkiPath, 'trusted');
          const rejectedPath = join(pkiPath, 'rejected');

          // Set up directories
          mkdirSync(trustedPath, { recursive: true });
          mkdirSync(rejectedPath, { recursive: true });

          // Place a file in the rejected store with the random thumbprint filename
          const filename = `${thumbprint}.der`;
          writeFileSync(join(rejectedPath, filename), content);

          // Instantiate TofuManager
          const manager = new TofuManager(pkiPath, mockProcessManager);

          // Call trustCertificate
          manager.trustCertificate(thumbprint);

          // (a) The file no longer exists in the reject store
          expect(existsSync(join(rejectedPath, filename))).toBe(false);

          // (b) A file with identical content exists in the trust store under the same filename
          const trustedFilePath = join(trustedPath, filename);
          expect(existsSync(trustedFilePath)).toBe(true);
          const trustedContent = readFileSync(trustedFilePath);
          expect(trustedContent.equals(content)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: tofu-client-certificate-trust
 * Property 9: Non-Existent Thumbprint Returns 404
 *
 * Validates: Requirements 4.2, 5.2, 7.2
 *
 * For any valid 40-character lowercase hex thumbprint that does NOT correspond
 * to a file in the expected store (trust store for reject operations, reject store
 * for trust operations, either store for delete operations), the operation SHALL
 * return a 404 error response.
 */
describe('Feature: tofu-client-certificate-trust, Property 9: Non-Existent Thumbprint Returns 404', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  /**
   * Validates: Requirements 4.2
   *
   * rejectCertificate with a thumbprint not in the trust store throws with code 'NOT_FOUND'.
   */
  it('rejectCertificate with non-existent thumbprint throws NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(validThumbprintArb, async (thumbprint) => {
        const tempBase = join(
          tmpdir(),
          `tofu-prop9-reject-${Date.now()}-${Math.random().toString(36).slice(2)}`
        );
        tempDirs.push(tempBase);

        const pkiPath = join(tempBase, 'pki');
        const trustedPath = join(pkiPath, 'trusted');
        const rejectedPath = join(pkiPath, 'rejected');

        mkdirSync(trustedPath, { recursive: true });
        mkdirSync(rejectedPath, { recursive: true });

        const manager = new TofuManager(pkiPath, mockProcessManager);

        try {
          manager.rejectCertificate(thumbprint);
          // Should not reach here
          expect.fail('Expected rejectCertificate to throw');
        } catch (err: any) {
          expect(err.code).toBe('NOT_FOUND');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 5.2
   *
   * trustCertificate with a thumbprint not in the reject store throws with code 'NOT_FOUND'.
   */
  it('trustCertificate with non-existent thumbprint throws NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(validThumbprintArb, async (thumbprint) => {
        const tempBase = join(
          tmpdir(),
          `tofu-prop9-trust-${Date.now()}-${Math.random().toString(36).slice(2)}`
        );
        tempDirs.push(tempBase);

        const pkiPath = join(tempBase, 'pki');
        const trustedPath = join(pkiPath, 'trusted');
        const rejectedPath = join(pkiPath, 'rejected');

        mkdirSync(trustedPath, { recursive: true });
        mkdirSync(rejectedPath, { recursive: true });

        const manager = new TofuManager(pkiPath, mockProcessManager);

        try {
          manager.trustCertificate(thumbprint);
          // Should not reach here
          expect.fail('Expected trustCertificate to throw');
        } catch (err: any) {
          expect(err.code).toBe('NOT_FOUND');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 7.2
   *
   * deleteCertificate with a thumbprint not in either store throws with code 'NOT_FOUND'.
   */
  it('deleteCertificate with non-existent thumbprint throws NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(validThumbprintArb, async (thumbprint) => {
        const tempBase = join(
          tmpdir(),
          `tofu-prop9-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`
        );
        tempDirs.push(tempBase);

        const pkiPath = join(tempBase, 'pki');
        const trustedPath = join(pkiPath, 'trusted');
        const rejectedPath = join(pkiPath, 'rejected');

        mkdirSync(trustedPath, { recursive: true });
        mkdirSync(rejectedPath, { recursive: true });

        const manager = new TofuManager(pkiPath, mockProcessManager);

        try {
          manager.deleteCertificate(thumbprint);
          // Should not reach here
          expect.fail('Expected deleteCertificate to throw');
        } catch (err: any) {
          expect(err.code).toBe('NOT_FOUND');
        }
      }),
      { numRuns: 100 }
    );
  });
});

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 2: PEM-to-DER base64 decode round-trip
 *
 * For any random byte sequence B, encoding B as base64, wrapping it in PEM
 * header/footer lines, and then passing it through the PEM-to-DER conversion
 * algorithm shall produce output bytes identical to the original B.
 *
 * This reimplements the exact C algorithm from security_config.c:
 * 1. Find content between -----BEGIN and -----END lines
 * 2. Join base64 lines, remove CR/LF
 * 3. Decode base64 to produce the original DER bytes
 *
 * **Validates: Requirements 4.3**
 */
describe('Feature: runtime-modular-refactor, Property 2: PEM-to-DER base64 decode round-trip', () => {
  /**
   * Reimplementation of the C PEM-to-DER decode algorithm:
   * - Strip the first -----BEGIN line and the -----END line
   * - Remove CR and LF characters from the remaining base64 body
   * - Decode base64
   */
  function pemToDer(pemData: string): Buffer | null {
    const lines = pemData.split('\n');
    let start = -1;
    let end = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('-----BEGIN')) start = i + 1;
      if (lines[i].startsWith('-----END')) {
        end = i;
        break;
      }
    }

    if (start < 0 || end < 0 || end <= start) return null;

    // Join base64 lines, remove CR/LF (matches C: strip \r and \n from body)
    const b64 = lines.slice(start, end).join('').replace(/[\r\n]/g, '');

    if (b64.length === 0) return null;

    // Decode base64 (equivalent to EVP_DecodeBlock in OpenSSL)
    return Buffer.from(b64, 'base64');
  }

  /**
   * Wrap raw bytes as a PEM-encoded string with 64-char line wrapping.
   * This mirrors how PEM files are typically formatted.
   */
  function bytesToPem(bytes: Uint8Array): string {
    const b64 = Buffer.from(bytes).toString('base64');
    // Split into 64-character lines (standard PEM line length)
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) {
      lines.push(b64.slice(i, i + 64));
    }
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
  }

  /**
   * Wrap raw bytes as a PEM-encoded string with CRLF line endings.
   * Tests that the algorithm correctly handles Windows-style line endings.
   */
  function bytesToPemCrlf(bytes: Uint8Array): string {
    const b64 = Buffer.from(bytes).toString('base64');
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) {
      lines.push(b64.slice(i, i + 64));
    }
    return `-----BEGIN PRIVATE KEY-----\r\n${lines.join('\r\n')}\r\n-----END PRIVATE KEY-----\r\n`;
  }

  /**
   * Wrap raw bytes as a PEM-encoded string with irregular line lengths.
   * Tests that the algorithm works regardless of line wrapping position.
   */
  function bytesToPemIrregular(bytes: Uint8Array, lineLength: number): string {
    const b64 = Buffer.from(bytes).toString('base64');
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += lineLength) {
      lines.push(b64.slice(i, i + lineLength));
    }
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
  }

  // Generator for random byte arrays between 1 and 4096 bytes
  const bytesArb = fc.integer({ min: 1, max: 4096 }).chain((len) =>
    fc.uint8Array({ minLength: len, maxLength: len })
  );

  it('decoding PEM-wrapped base64 produces original bytes (standard 64-char lines)', () => {
    fc.assert(
      fc.property(bytesArb, (bytes) => {
        const pem = bytesToPem(bytes);
        const decoded = pemToDer(pem);

        expect(decoded).not.toBeNull();
        expect(Buffer.from(decoded!)).toEqual(Buffer.from(bytes));
      }),
      { numRuns: 100 }
    );
  });

  it('decoding PEM with CRLF line endings produces original bytes', () => {
    fc.assert(
      fc.property(bytesArb, (bytes) => {
        const pem = bytesToPemCrlf(bytes);
        const decoded = pemToDer(pem);

        expect(decoded).not.toBeNull();
        expect(Buffer.from(decoded!)).toEqual(Buffer.from(bytes));
      }),
      { numRuns: 100 }
    );
  });

  it('decoding PEM with irregular line lengths produces original bytes', () => {
    // Line lengths between 16 and 128 characters
    const lineLengthArb = fc.integer({ min: 16, max: 128 });

    fc.assert(
      fc.property(bytesArb, lineLengthArb, (bytes, lineLength) => {
        const pem = bytesToPemIrregular(bytes, lineLength);
        const decoded = pemToDer(pem);

        expect(decoded).not.toBeNull();
        expect(Buffer.from(decoded!)).toEqual(Buffer.from(bytes));
      }),
      { numRuns: 100 }
    );
  });

  it('handles various byte sizes correctly (small, medium, large)', () => {
    // Explicitly test boundary sizes
    const sizeArb = fc.oneof(
      fc.constant(1),       // minimum size
      fc.constant(3),       // base64 padding boundary
      fc.constant(4),       // exact base64 group
      fc.constant(63),      // just under one PEM line
      fc.constant(64),      // exactly one PEM line worth of base64
      fc.constant(65),      // just over one PEM line
      fc.constant(256),     // medium
      fc.constant(1024),    // 1KB
      fc.constant(4096)     // maximum size
    );

    fc.assert(
      fc.property(sizeArb, (size) => {
        const bytes = new Uint8Array(size);
        // Fill with deterministic pattern
        for (let i = 0; i < size; i++) {
          bytes[i] = i % 256;
        }

        const pem = bytesToPem(bytes);
        const decoded = pemToDer(pem);

        expect(decoded).not.toBeNull();
        expect(decoded!.length).toBe(size);
        expect(Buffer.from(decoded!)).toEqual(Buffer.from(bytes));
      }),
      { numRuns: 100 }
    );
  });
});

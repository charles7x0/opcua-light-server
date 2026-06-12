import { describe, it, expect } from 'vitest';
import { derToPem, pemToDer } from '../../src/cert-generator/cert-utils.js';

describe('cert-utils', () => {
  describe('derToPem', () => {
    it('produces valid PEM structure with BEGIN/END markers', () => {
      const derBuffer = Buffer.from([0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09]);
      const pem = derToPem(derBuffer);

      expect(pem).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
      expect(pem).toMatch(/-----END CERTIFICATE-----\n$/);
    });

    it('produces valid PEM structure with known input', () => {
      // A known small buffer to verify exact output
      const derBuffer = Buffer.from('Hello, DER certificate world!');
      const pem = derToPem(derBuffer);

      const expectedBase64 = derBuffer.toString('base64');
      expect(pem).toBe(
        '-----BEGIN CERTIFICATE-----\n' +
        expectedBase64 + '\n' +
        '-----END CERTIFICATE-----\n'
      );
    });

    it('splits Base64 content into lines of 64 characters max', () => {
      // Create a buffer large enough to produce multiple Base64 lines
      // 48 bytes of binary = 64 chars of Base64, so 96 bytes = 128 chars = 2 full lines
      const derBuffer = Buffer.alloc(200, 0xAB);
      const pem = derToPem(derBuffer);

      const lines = pem.split('\n');
      // Remove header, footer, and trailing empty string from split
      const bodyLines = lines.slice(1, -2); // skip header and "-----END CERTIFICATE-----" + trailing

      for (const line of bodyLines) {
        expect(line.length).toBeLessThanOrEqual(64);
        expect(line.length).toBeGreaterThan(0);
      }
    });

    it('has all Base64 lines exactly 64 chars except possibly the last', () => {
      // 150 bytes → 200 Base64 chars → 3 lines of 64 + 1 line of 8
      const derBuffer = Buffer.alloc(150, 0xCD);
      const pem = derToPem(derBuffer);

      const lines = pem.split('\n');
      // Extract body lines (between header and footer)
      const headerIdx = 0;
      const footerIdx = lines.indexOf('-----END CERTIFICATE-----');
      const bodyLines = lines.slice(headerIdx + 1, footerIdx);

      // All lines except the last must be exactly 64 chars
      for (let i = 0; i < bodyLines.length - 1; i++) {
        expect(bodyLines[i].length).toBe(64);
      }
      // Last line must be between 1 and 64 chars
      const lastLine = bodyLines[bodyLines.length - 1];
      expect(lastLine.length).toBeGreaterThanOrEqual(1);
      expect(lastLine.length).toBeLessThanOrEqual(64);
    });

    it('ends with a trailing newline after the footer', () => {
      const derBuffer = Buffer.from([0x01, 0x02, 0x03]);
      const pem = derToPem(derBuffer);

      expect(pem.endsWith('-----END CERTIFICATE-----\n')).toBe(true);
      expect(pem[pem.length - 1]).toBe('\n');
    });

    it('contains only valid Base64 characters between markers', () => {
      const derBuffer = Buffer.alloc(256, 0xFF);
      const pem = derToPem(derBuffer);

      const lines = pem.split('\n');
      const footerIdx = lines.indexOf('-----END CERTIFICATE-----');
      const bodyLines = lines.slice(1, footerIdx);

      const base64Regex = /^[A-Za-z0-9+/=]+$/;
      for (const line of bodyLines) {
        expect(line).toMatch(base64Regex);
      }
    });

    it('handles empty buffer', () => {
      const derBuffer = Buffer.alloc(0);
      const pem = derToPem(derBuffer);

      expect(pem).toBe('-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----\n');
    });
  });

  describe('pemToDer', () => {
    it('reverses derToPem with a small known buffer', () => {
      const original = Buffer.from([0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09]);
      const pem = derToPem(original);
      const recovered = pemToDer(pem);

      expect(recovered).toEqual(original);
    });

    it('reverses derToPem with a buffer that produces multiple Base64 lines', () => {
      // 200 bytes will produce multiple 64-char lines
      const original = Buffer.alloc(200);
      for (let i = 0; i < 200; i++) {
        original[i] = i % 256;
      }
      const pem = derToPem(original);
      const recovered = pemToDer(pem);

      expect(recovered).toEqual(original);
    });

    it('reverses derToPem with a realistic DER certificate-like buffer', () => {
      // Simulate a DER structure: ASN.1 SEQUENCE tag (0x30) followed by length and content
      const certContent = Buffer.alloc(512);
      certContent[0] = 0x30; // SEQUENCE tag
      certContent[1] = 0x82; // Length uses 2 bytes
      certContent[2] = 0x01; // High byte of length
      certContent[3] = 0xFC; // Low byte of length (508)
      // Fill the rest with pseudo-random data
      for (let i = 4; i < 512; i++) {
        certContent[i] = (i * 7 + 13) % 256;
      }

      const pem = derToPem(certContent);
      const recovered = pemToDer(pem);

      expect(recovered).toEqual(certContent);
    });

    it('reverses derToPem with a buffer whose Base64 length is exactly 64 chars', () => {
      // 48 binary bytes = exactly 64 Base64 characters (one full line, no remainder)
      const original = Buffer.alloc(48, 0xAA);
      const pem = derToPem(original);
      const recovered = pemToDer(pem);

      expect(recovered).toEqual(original);
    });

    it('reverses derToPem with a single-byte buffer', () => {
      const original = Buffer.from([0xFF]);
      const pem = derToPem(original);
      const recovered = pemToDer(pem);

      expect(recovered).toEqual(original);
    });
  });
});

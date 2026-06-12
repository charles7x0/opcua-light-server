/**
 * Pure utility functions for converting between DER and PEM certificate formats.
 * No side effects — these operate only on in-memory data.
 */

const PEM_HEADER = '-----BEGIN CERTIFICATE-----\n';
const PEM_FOOTER = '-----END CERTIFICATE-----\n';
const PEM_LINE_LENGTH = 64;

/**
 * Convert a DER-encoded certificate buffer to PEM format.
 *
 * Base64-encodes the buffer, splits into 64-character lines with LF endings,
 * and wraps with BEGIN/END CERTIFICATE markers. Output always ends with a
 * trailing newline after the footer.
 *
 * @param derBuffer - Raw DER-encoded certificate bytes
 * @returns PEM-encoded certificate string
 */
export function derToPem(derBuffer: Buffer): string {
  const base64 = derBuffer.toString('base64');

  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += PEM_LINE_LENGTH) {
    lines.push(base64.slice(i, i + PEM_LINE_LENGTH));
  }

  return PEM_HEADER + lines.join('\n') + '\n' + PEM_FOOTER;
}

/**
 * Decode a PEM-encoded certificate string back to DER binary buffer.
 *
 * Strips the BEGIN/END CERTIFICATE header and footer lines,
 * joins the remaining Base64 lines, and decodes to a Buffer.
 *
 * @param pemString - PEM-encoded certificate string
 * @returns Raw DER-encoded certificate bytes
 */
export function pemToDer(pemString: string): Buffer {
  const base64 = pemString
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  return Buffer.from(base64, 'base64');
}

/**
 * Thumbprint validation utility for client certificate management.
 * A valid thumbprint is a 40-character lowercase hexadecimal string
 * representing the SHA-1 hash of a DER-encoded certificate.
 */

const THUMBPRINT_REGEX = /^[0-9a-f]{40}$/;

/**
 * Validates whether a string is a valid certificate thumbprint.
 * A valid thumbprint is exactly 40 lowercase hexadecimal characters (SHA-1 hash).
 */
export function isValidThumbprint(value: string): boolean {
  return THUMBPRINT_REGEX.test(value);
}

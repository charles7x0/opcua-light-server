/**
 * TOFU (Trust On First Use) client certificate manager.
 * Manages the PKI directory structure, persists client certificates,
 * and exposes trust/reject operations via the Control API.
 */

export { isValidThumbprint } from './thumbprint.js';
export { TofuManager } from './tofu-manager.js';

/** Information about a client certificate stored in the PKI trust/reject store. */
export interface CertificateInfo {
  /** SHA-1 thumbprint of the DER-encoded certificate (40-char lowercase hex) */
  thumbprint: string;
  /** Current trust status of the certificate */
  status: 'trusted' | 'rejected';
  /** Subject common name from the certificate */
  subject: string;
  /** Issuer common name from the certificate */
  issuer: string;
  /** Certificate validity start date in ISO 8601 format */
  notBefore: string;
  /** Certificate validity end date in ISO 8601 format */
  notAfter: string;
  /** Size of the certificate file in bytes */
  fileSize: number;
}

/**
 * HTTPS server module for the Control API.
 * Provides conditional HTTPS support using the generated self-signed certificate
 * when security mode is Sign or SignAndEncrypt.
 */

import https from 'node:https';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import type { Express } from 'express';
import type { SecurityConfig } from '../types/index.js';

/** Configuration paths for HTTPS certificate and key files. */
export interface HttpsConfig {
  /** Path to the certificate file (DER format) */
  certPath: string;
  /** Path to the private key file (PEM format) */
  keyPath: string;
}

/**
 * Determine whether the server should use HTTPS based on the security configuration.
 *
 * Returns true only when:
 * - Security mode is 'Sign' or 'SignAndEncrypt'
 * - A certificate path is configured (non-empty string)
 * - A private key is configured
 */
export function shouldUseHttps(securityConfig: SecurityConfig): boolean {
  const isSecureMode = securityConfig.mode === 'Sign' || securityConfig.mode === 'SignAndEncrypt';
  const hasCertificate = !!securityConfig.certificatePath;
  const hasPrivateKey = securityConfig.privateKeyConfigured;

  return isSecureMode && hasCertificate && hasPrivateKey;
}

/**
 * Create an HTTPS server using the configured certificate and private key.
 *
 * The certificate file is expected in DER format (binary) and is converted to PEM
 * for Node.js's https module. The private key file is expected in PEM format.
 */
export function createHttpsServer(app: Express, config: HttpsConfig): https.Server {
  // Read the DER certificate and convert to PEM
  const certDerBuffer = readFileSync(config.certPath);
  const certDer = forge.util.createBuffer(certDerBuffer.toString('binary'));
  const asn1 = forge.asn1.fromDer(certDer);
  const cert = forge.pki.certificateFromAsn1(asn1);
  const certPem = forge.pki.certificateToPem(cert);

  // Read the private key (already in PEM format)
  const keyPem = readFileSync(config.keyPath, 'utf-8');

  const server = https.createServer({ cert: certPem, key: keyPem }, app);

  return server;
}

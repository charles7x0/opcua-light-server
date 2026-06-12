/**
 * Self-signed certificate generator for OPC UA server security.
 * Uses node-forge to generate RSA 2048-bit keys and X.509 certificates
 * with OPC UA-specific extensions (Application URI in SAN).
 */

import forge from 'node-forge';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { networkInterfaces } from 'os';
import { validateGenerateRequest } from './validation.js';

/** Options for certificate generation. */
export interface CertGenerateOptions {
  /** Application URI for OPC UA (default: urn:opcua-light-server:application) */
  applicationUri?: string;
  /** Certificate validity in days (default: 1825 = 5 years) */
  validityDays?: number;
  /** Subject Alternative Name DNS entries */
  dnsNames?: string[];
  /** Subject Alternative Name IP entries */
  ipAddresses?: string[];
  /** Organization name for the certificate subject */
  organization?: string;
  /** Country code (2-letter) for the certificate subject */
  country?: string;
  /** Common Name for the certificate subject */
  commonName?: string;
}

/** Result of certificate generation. */
export interface CertGenerateResult {
  /** Absolute path to the generated certificate file (DER format) */
  certificatePath: string;
  /** Absolute path to the generated private key file (PEM format) */
  privateKeyPath: string;
  /** Certificate expiry date as ISO string */
  expiresAt: string;
  /** Certificate creation date as ISO string */
  createdAt: string;
}

/** Certificate expiry information. */
export interface CertExpiryInfo {
  /** Certificate expiry date as ISO string */
  expiresAt: string;
  /** Certificate creation date as ISO string */
  createdAt: string;
  /** Remaining days until expiry */
  remainingDays: number;
}

const DEFAULT_APPLICATION_URI = 'urn:opcua-light-server:application';
const DEFAULT_VALIDITY_DAYS = 1825; // 5 years
const DEFAULT_COMMON_NAME = 'OPC UA Light Server';
const LOOPBACK_IP = '127.0.0.1';

/**
 * Detect local non-loopback IPv4 addresses from network interfaces.
 */
function detectLocalIpAddresses(): string[] {
  const addresses: string[] = [];
  const interfaces = networkInterfaces();

  for (const name in interfaces) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      // Skip loopback and non-IPv4
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

/**
 * Generate a self-signed X.509 certificate with OPC UA extensions.
 *
 * - RSA 2048-bit key pair
 * - SHA-256 signature
 * - Application URI in Subject Alternative Name (OPC UA requirement)
 * - DNS and IP SANs for network connectivity
 * - Key usage: digitalSignature, keyEncipherment, nonRepudiation, dataEncipherment
 * - Extended key usage: serverAuth, clientAuth
 *
 * Write ordering: key file is written before certificate file.
 * Cleanup: if certificate write fails, the already-written key file is removed.
 * File permissions: private key is set to 0o400 (owner-read-only) on POSIX systems.
 */
export function generateCertificate(
  certOutputPath: string,
  keyOutputPath: string,
  options: CertGenerateOptions = {}
): CertGenerateResult {
  // Run input validation before generation
  const validationErrors = validateGenerateRequest({
    commonName: options.commonName,
    organization: options.organization,
    country: options.country,
    dnsNames: options.dnsNames,
    ipAddresses: options.ipAddresses,
  });

  if (validationErrors.length > 0) {
    const messages = validationErrors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new Error(`Validation failed: ${messages}`);
  }

  // Resolve options with trimming and defaults
  const applicationUri = options.applicationUri ?? DEFAULT_APPLICATION_URI;
  const validityDays = options.validityDays ?? DEFAULT_VALIDITY_DAYS;

  // Trim string inputs
  const rawCommonName = options.commonName?.trim();
  const rawOrganization = options.organization?.trim();
  const rawCountry = options.country?.trim();

  // Default commonName to "OPC UA Light Server" when missing or empty
  const commonName = rawCommonName && rawCommonName.length > 0 ? rawCommonName : DEFAULT_COMMON_NAME;

  // DNS names: trim each entry
  const dnsNames = (options.dnsNames ?? []).map((d) => d.trim()).filter((d) => d.length > 0);

  // IP addresses: determine SAN IPs
  const providedIps = (options.ipAddresses ?? []).map((ip) => ip.trim()).filter((ip) => ip.length > 0);
  let sanIps: string[];

  if (providedIps.length > 0) {
    // Use provided IPs, always including 127.0.0.1
    const ipSet = new Set(providedIps);
    ipSet.add(LOOPBACK_IP);
    sanIps = Array.from(ipSet);
  } else {
    // Auto-detect local IPs, always including 127.0.0.1
    const detected = detectLocalIpAddresses();
    const ipSet = new Set(detected);
    ipSet.add(LOOPBACK_IP);
    sanIps = Array.from(ipSet);
  }

  // Generate RSA 2048-bit key pair
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

  // Create certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = generateSerialNumber();

  // Set validity period
  const now = new Date();
  cert.validity.notBefore = now;
  const expiryDate = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  cert.validity.notAfter = expiryDate;

  // Build subject attributes — omit Organization and Country if not provided
  const attrs: forge.pki.CertificateField[] = [
    { shortName: 'CN', value: commonName },
  ];

  if (rawOrganization && rawOrganization.length > 0) {
    attrs.push({ shortName: 'O', value: rawOrganization });
  }

  if (rawCountry && rawCountry.length > 0) {
    attrs.push({ shortName: 'C', value: rawCountry });
  }

  // Set subject and issuer (self-signed: identical)
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Build Subject Alternative Names
  // node-forge uses numeric type codes: 2=DNS, 6=URI, 7=IP
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const altNames: any[] = [
    { type: 6, value: applicationUri }, // URI
  ];

  for (const dns of dnsNames) {
    altNames.push({ type: 2, value: dns }); // DNS
  }

  for (const ip of sanIps) {
    altNames.push({ type: 7, ip }); // IP
  }

  // Set extensions
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      nonRepudiation: true,
      dataEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  // Self-sign with SHA-256
  cert.sign(keyPair.privateKey, forge.md.sha256.create());

  // Convert certificate to DER format
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const certBuffer = Buffer.from(certDer, 'binary');

  // Convert private key to PEM format
  const keyPem = forge.pki.privateKeyToPem(keyPair.privateKey);

  // Ensure output directories exist
  mkdirSync(dirname(keyOutputPath), { recursive: true });
  mkdirSync(dirname(certOutputPath), { recursive: true });

  // Write key file FIRST (before certificate)
  writeFileSync(keyOutputPath, keyPem, 'utf-8');

  // Set file permissions to owner-read-only on POSIX systems
  if (process.platform !== 'win32') {
    try {
      chmodSync(keyOutputPath, 0o400);
    } catch {
      // Ignore permission errors on non-POSIX systems
    }
  }

  // Write certificate file — if this fails, clean up the key file
  try {
    writeFileSync(certOutputPath, certBuffer);
  } catch (error) {
    // Cleanup: remove already-written key file
    try {
      unlinkSync(keyOutputPath);
    } catch {
      // Best-effort cleanup; ignore if key file removal fails
    }
    throw error;
  }

  return {
    certificatePath: certOutputPath,
    privateKeyPath: keyOutputPath,
    expiresAt: expiryDate.toISOString(),
    createdAt: now.toISOString(),
  };
}

/**
 * Read certificate expiry information from a DER-encoded certificate file.
 * Returns null if the file cannot be read or parsed.
 * Returns remainingDays: 0 for expired certificates.
 */
export function readCertificateExpiry(certPath: string): CertExpiryInfo | null {
  try {
    const certBuffer = readFileSync(certPath);
    const certDer = forge.util.createBuffer(certBuffer.toString('binary'));
    const asn1 = forge.asn1.fromDer(certDer);
    const cert = forge.pki.certificateFromAsn1(asn1);

    const expiresAt = cert.validity.notAfter;
    const createdAt = cert.validity.notBefore;
    const now = new Date();
    const remainingMs = expiresAt.getTime() - now.getTime();
    const remainingDays = Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));

    return {
      expiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
      remainingDays,
    };
  } catch {
    return null;
  }
}

/**
 * Generate a random serial number for the certificate.
 * Random length between 8 and 20 bytes (inclusive) per X.509 requirements.
 */
function generateSerialNumber(): string {
  // Random byte length between 8 and 20 inclusive
  const minBytes = 8;
  const maxBytes = 20;
  const byteLength = minBytes + Math.floor(Math.random() * (maxBytes - minBytes + 1));
  const bytes = forge.random.getBytesSync(byteLength);

  // Ensure the serial number is positive by clearing the high bit
  const byteArray = bytes.split('').map((c) => c.charCodeAt(0));
  byteArray[0] = byteArray[0] & 0x7f; // Clear high bit to ensure positive
  // Ensure at least one non-zero byte so the number is positive
  if (byteArray[0] === 0) {
    byteArray[0] = 1;
  }

  return byteArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

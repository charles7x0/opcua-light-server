/**
 * Input validation for certificate generation requests.
 * All string inputs are trimmed before validation.
 */

import type { GenerateCertificateRequest } from "../types/api.js";

/** A single validation error with field name and message. */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate an IPv4 dotted-decimal address.
 * Format: four octets (0-255) separated by dots.
 */
function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * Validate an IPv6 colon-hexadecimal address.
 * Supports full, compressed (::), and mixed notation.
 */
function isValidIpv6(ip: string): boolean {
  // Handle empty string
  if (ip.length === 0) return false;

  // IPv6 with zone ID is not supported
  if (ip.includes("%")) return false;

  // Handle :: shorthand
  const doubleColonCount = (ip.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  // Split by :: first to handle compression
  if (doubleColonCount === 1) {
    const [left, right] = ip.split("::");
    const leftParts = left === "" ? [] : left.split(":");
    const rightParts = right === "" ? [] : right.split(":");
    const totalParts = leftParts.length + rightParts.length;
    if (totalParts > 7) return false;
    const allParts = [...leftParts, ...rightParts];
    return allParts.every((part) => /^[0-9a-fA-F]{1,4}$/.test(part));
  }

  // Full notation: exactly 8 groups
  const parts = ip.split(":");
  if (parts.length !== 8) return false;
  return parts.every((part) => /^[0-9a-fA-F]{1,4}$/.test(part));
}

/**
 * Validate an IP address (IPv4 dotted-decimal or IPv6 colon-hexadecimal).
 * Input is trimmed before validation.
 */
export function validateIpAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (trimmed.length === 0) return false;
  return isValidIpv4(trimmed) || isValidIpv6(trimmed);
}

/**
 * Validate a DNS name.
 * Must contain only hostname characters [a-zA-Z0-9.-] and be ≤253 chars.
 * Input is trimmed before validation.
 */
export function validateDnsName(dns: string): boolean {
  const trimmed = dns.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 253) return false;
  return /^[a-zA-Z0-9.\-]+$/.test(trimmed);
}

/**
 * Validate a country code.
 * Must be exactly 2 uppercase ASCII letters (A-Z).
 * Input is trimmed before validation.
 */
export function validateCountryCode(code: string): boolean {
  const trimmed = code.trim();
  return /^[A-Z]{2}$/.test(trimmed);
}

/**
 * Validate a Common Name.
 * Must be 1-64 characters after trimming.
 * Input is trimmed before validation.
 */
export function validateCommonName(cn: string): boolean {
  const trimmed = cn.trim();
  return trimmed.length >= 1 && trimmed.length <= 64;
}

/**
 * Validate an Organization name.
 * Must be 1-64 characters after trimming.
 * Input is trimmed before validation.
 */
export function validateOrganization(org: string): boolean {
  const trimmed = org.trim();
  return trimmed.length >= 1 && trimmed.length <= 64;
}

/**
 * Validate a complete GenerateCertificateRequest body.
 * Aggregates all field errors into a single array.
 * All string inputs are trimmed before validation.
 */
export function validateGenerateRequest(
  body: GenerateCertificateRequest,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate commonName if provided
  if (body.commonName !== undefined && body.commonName !== null) {
    const trimmed = (body.commonName as string).trim();
    if (trimmed.length > 0 && !validateCommonName(trimmed)) {
      errors.push({
        field: "commonName",
        message: "Common name must be 1-64 characters",
      });
    }
  }

  // Validate organization if provided
  if (body.organization !== undefined && body.organization !== null) {
    const trimmed = (body.organization as string).trim();
    if (trimmed.length > 0 && !validateOrganization(trimmed)) {
      errors.push({
        field: "organization",
        message: "Organization must be 1-64 characters",
      });
    }
  }

  // Validate country if provided
  if (body.country !== undefined && body.country !== null) {
    const trimmed = (body.country as string).trim();
    if (trimmed.length > 0 && !validateCountryCode(trimmed)) {
      errors.push({
        field: "country",
        message: "Country must be exactly 2 uppercase ASCII letters (A-Z)",
      });
    }
  }

  // Validate dnsNames if provided
  if (
    body.dnsNames !== undefined &&
    body.dnsNames !== null &&
    Array.isArray(body.dnsNames)
  ) {
    for (let i = 0; i < body.dnsNames.length; i++) {
      const dns = body.dnsNames[i];
      if (typeof dns === "string") {
        const trimmed = dns.trim();
        if (!validateDnsName(trimmed)) {
          errors.push({
            field: "dnsNames",
            message: `Invalid DNS name at index ${i}: must contain only [a-zA-Z0-9.-] and be 1-253 characters`,
          });
        }
      }
    }
  }

  // Validate ipAddresses if provided
  if (
    body.ipAddresses !== undefined &&
    body.ipAddresses !== null &&
    Array.isArray(body.ipAddresses)
  ) {
    for (let i = 0; i < body.ipAddresses.length; i++) {
      const ip = body.ipAddresses[i];
      if (typeof ip === "string") {
        const trimmed = ip.trim();
        if (!validateIpAddress(trimmed)) {
          errors.push({
            field: "ipAddresses",
            message: `Invalid IP address at index ${i}: must be a valid IPv4 or IPv6 address`,
          });
        }
      }
    }
  }

  return errors;
}

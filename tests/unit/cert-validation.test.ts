import { describe, it, expect } from 'vitest';
import {
  validateIpAddress,
  validateDnsName,
  validateCountryCode,
  validateCommonName,
  validateOrganization,
  validateGenerateRequest,
} from '../../src/cert-generator/validation.js';

describe('validateIpAddress', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(validateIpAddress('192.168.1.1')).toBe(true);
    expect(validateIpAddress('0.0.0.0')).toBe(true);
    expect(validateIpAddress('255.255.255.255')).toBe(true);
    expect(validateIpAddress('127.0.0.1')).toBe(true);
    expect(validateIpAddress('10.0.0.1')).toBe(true);
  });

  it('accepts valid IPv6 addresses', () => {
    expect(validateIpAddress('::1')).toBe(true);
    expect(validateIpAddress('fe80::1')).toBe(true);
    expect(validateIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(validateIpAddress('2001:db8::1')).toBe(true);
    expect(validateIpAddress('::')).toBe(true);
  });

  it('rejects invalid IP addresses', () => {
    expect(validateIpAddress('')).toBe(false);
    expect(validateIpAddress('256.1.1.1')).toBe(false);
    expect(validateIpAddress('1.2.3')).toBe(false);
    expect(validateIpAddress('1.2.3.4.5')).toBe(false);
    expect(validateIpAddress('abc')).toBe(false);
    expect(validateIpAddress('01.02.03.04')).toBe(false);
    expect(validateIpAddress('192.168.1')).toBe(false);
    expect(validateIpAddress('not-an-ip')).toBe(false);
  });

  it('trims whitespace before validation', () => {
    expect(validateIpAddress('  192.168.1.1  ')).toBe(true);
    expect(validateIpAddress('  ::1  ')).toBe(true);
  });
});

describe('validateDnsName', () => {
  it('accepts valid DNS names', () => {
    expect(validateDnsName('example.com')).toBe(true);
    expect(validateDnsName('my-server.local')).toBe(true);
    expect(validateDnsName('opcua-server')).toBe(true);
    expect(validateDnsName('a')).toBe(true);
    expect(validateDnsName('sub.domain.example.com')).toBe(true);
  });

  it('rejects empty or too-long DNS names', () => {
    expect(validateDnsName('')).toBe(false);
    expect(validateDnsName('   ')).toBe(false);
    expect(validateDnsName('a'.repeat(254))).toBe(false);
  });

  it('rejects DNS names with invalid characters', () => {
    expect(validateDnsName('my_server')).toBe(false);
    expect(validateDnsName('server name')).toBe(false);
    expect(validateDnsName('server@host')).toBe(false);
    expect(validateDnsName('server/path')).toBe(false);
  });

  it('accepts max length DNS name (253 chars)', () => {
    expect(validateDnsName('a'.repeat(253))).toBe(true);
  });

  it('trims whitespace before validation', () => {
    expect(validateDnsName('  example.com  ')).toBe(true);
  });
});

describe('validateCountryCode', () => {
  it('accepts valid 2-letter uppercase country codes', () => {
    expect(validateCountryCode('US')).toBe(true);
    expect(validateCountryCode('BR')).toBe(true);
    expect(validateCountryCode('DE')).toBe(true);
    expect(validateCountryCode('JP')).toBe(true);
  });

  it('rejects invalid country codes', () => {
    expect(validateCountryCode('')).toBe(false);
    expect(validateCountryCode('A')).toBe(false);
    expect(validateCountryCode('USA')).toBe(false);
    expect(validateCountryCode('us')).toBe(false);
    expect(validateCountryCode('U1')).toBe(false);
    expect(validateCountryCode('12')).toBe(false);
  });

  it('trims whitespace before validation', () => {
    expect(validateCountryCode('  US  ')).toBe(true);
  });
});

describe('validateCommonName', () => {
  it('accepts valid common names (1-64 chars after trim)', () => {
    expect(validateCommonName('OPC UA Light Server')).toBe(true);
    expect(validateCommonName('a')).toBe(true);
    expect(validateCommonName('a'.repeat(64))).toBe(true);
  });

  it('rejects empty or too-long common names', () => {
    expect(validateCommonName('')).toBe(false);
    expect(validateCommonName('   ')).toBe(false);
    expect(validateCommonName('a'.repeat(65))).toBe(false);
  });

  it('trims whitespace before validation', () => {
    expect(validateCommonName('  Server  ')).toBe(true);
  });
});

describe('validateOrganization', () => {
  it('accepts valid organization names (1-64 chars after trim)', () => {
    expect(validateOrganization('My Company')).toBe(true);
    expect(validateOrganization('a')).toBe(true);
    expect(validateOrganization('a'.repeat(64))).toBe(true);
  });

  it('rejects empty or too-long organization names', () => {
    expect(validateOrganization('')).toBe(false);
    expect(validateOrganization('   ')).toBe(false);
    expect(validateOrganization('a'.repeat(65))).toBe(false);
  });

  it('trims whitespace before validation', () => {
    expect(validateOrganization('  Org  ')).toBe(true);
  });
});

describe('validateGenerateRequest', () => {
  it('returns no errors for a valid request', () => {
    const errors = validateGenerateRequest({
      commonName: 'Test Server',
      organization: 'Test Org',
      country: 'US',
      dnsNames: ['example.com'],
      ipAddresses: ['192.168.1.1'],
    });
    expect(errors).toHaveLength(0);
  });

  it('returns no errors for an empty request (all optional)', () => {
    const errors = validateGenerateRequest({});
    expect(errors).toHaveLength(0);
  });

  it('aggregates multiple validation errors', () => {
    const errors = validateGenerateRequest({
      country: 'invalid',
      dnsNames: ['valid.com', 'inv@lid'],
      ipAddresses: ['not-an-ip'],
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.some((e) => e.field === 'country')).toBe(true);
    expect(errors.some((e) => e.field === 'dnsNames')).toBe(true);
    expect(errors.some((e) => e.field === 'ipAddresses')).toBe(true);
  });

  it('validates commonName length', () => {
    const errors = validateGenerateRequest({
      commonName: 'a'.repeat(65),
    });
    expect(errors.some((e) => e.field === 'commonName')).toBe(true);
  });

  it('validates organization length', () => {
    const errors = validateGenerateRequest({
      organization: 'a'.repeat(65),
    });
    expect(errors.some((e) => e.field === 'organization')).toBe(true);
  });

  it('accepts IPv6 addresses', () => {
    const errors = validateGenerateRequest({
      ipAddresses: ['::1', '2001:db8::1'],
    });
    expect(errors).toHaveLength(0);
  });

  it('trims inputs before validating', () => {
    const errors = validateGenerateRequest({
      commonName: '  Valid Server  ',
      country: '  US  ',
      dnsNames: ['  example.com  '],
      ipAddresses: ['  192.168.1.1  '],
    });
    expect(errors).toHaveLength(0);
  });
});

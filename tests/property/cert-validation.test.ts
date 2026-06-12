import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateIpAddress,
  validateDnsName,
  validateCountryCode,
  validateGenerateRequest,
} from '../../src/cert-generator/validation.js';

/**
 * Feature: cert-generation
 * Properties 8, 9, 10, 11: Validation rejection and whitespace trimming
 *
 * Validates: Requirements 3.7, 3.8, 9.1, 9.2, 9.3, 9.4
 */

// --- Generators ---

/** Generate a string that is NOT a valid IPv4 address (four octets 0-255 separated by dots). */
function invalidIpv4Arbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    // Empty string
    fc.constant(''),
    // Too few octets (1-3 parts)
    fc.integer({ min: 0, max: 255 }).map((n) => `${n}`),
    fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map(
      ([a, b]) => `${a}.${b}`
    ),
    fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c]) => `${a}.${b}.${c}`),
    // Too many octets (5+ parts)
    fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c, d, e]) => `${a}.${b}.${c}.${d}.${e}`),
    // Octet out of range (256-999)
    fc.tuple(
      fc.integer({ min: 256, max: 999 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    // Contains alphabetic characters
    fc.tuple(
      fc.stringOf(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z'), { minLength: 1, maxLength: 5 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    // Leading zeros (invalid strict format like "01.02.03.04")
    fc.tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c, d]) => `0${a}.${b}.${c}.${d}`),
    // Random string with no dots
    fc.stringOf(fc.constantFrom('a', 'b', '1', '2', '!', '@'), { minLength: 1, maxLength: 15 })
      .filter((s) => !s.includes('.'))
  );
}

/** Generate a valid IPv4 address (for whitespace trimming tests). */
function validIpv4Arbitrary(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
}

/** Generate an invalid DNS name: empty string or >253 chars. */
function invalidDnsNameArbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    // Empty string
    fc.constant(''),
    // Only whitespace (becomes empty after trim)
    fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 5 }),
    // Exceeds 253 characters
    fc.stringOf(fc.constantFrom('a', 'b', 'c', '1', '.', '-'), { minLength: 254, maxLength: 300 })
  );
}

/** Generate a valid DNS name (for whitespace trimming tests). */
function validDnsNameArbitrary(): fc.Arbitrary<string> {
  return fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-', '.'), {
    minLength: 1,
    maxLength: 63,
  }).filter((s) => /^[a-zA-Z0-9.\-]+$/.test(s));
}

/** Generate a string that is NOT exactly 2 uppercase ASCII letters. */
function invalidCountryCodeArbitrary(): fc.Arbitrary<string> {
  return fc.oneof(
    // Empty string
    fc.constant(''),
    // Single uppercase letter
    fc.integer({ min: 65, max: 90 }).map((c) => String.fromCharCode(c)),
    // Three or more uppercase letters
    fc.stringOf(fc.integer({ min: 65, max: 90 }).map((c) => String.fromCharCode(c)), {
      minLength: 3,
      maxLength: 6,
    }),
    // Two lowercase letters
    fc.tuple(
      fc.integer({ min: 97, max: 122 }),
      fc.integer({ min: 97, max: 122 })
    ).map(([a, b]) => String.fromCharCode(a) + String.fromCharCode(b)),
    // Two characters with digits
    fc.tuple(
      fc.integer({ min: 48, max: 57 }),
      fc.integer({ min: 65, max: 90 })
    ).map(([a, b]) => String.fromCharCode(a) + String.fromCharCode(b)),
    // Mixed case (one upper, one lower)
    fc.tuple(
      fc.integer({ min: 65, max: 90 }),
      fc.integer({ min: 97, max: 122 })
    ).map(([a, b]) => String.fromCharCode(a) + String.fromCharCode(b))
  );
}

/** Generate a valid 2-letter uppercase country code (for whitespace trimming tests). */
function validCountryCodeArbitrary(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.integer({ min: 65, max: 90 }),
    fc.integer({ min: 65, max: 90 })
  ).map(([a, b]) => String.fromCharCode(a) + String.fromCharCode(b));
}

/** Generate whitespace to pad around a value. */
function whitespaceArbitrary(): fc.Arbitrary<string> {
  return fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 4 });
}

// --- Property Tests ---

describe('Feature: cert-generation, Property 8: Invalid IP Rejection', () => {
  /**
   * Validates: Requirements 3.7, 9.1
   *
   * For any string not matching IPv4 dotted-decimal format,
   * validateIpAddress returns false.
   *
   * Note: The validator also accepts IPv6, so we specifically test strings
   * that are neither valid IPv4 nor valid IPv6.
   */
  it('should reject any string that is not a valid IPv4 dotted-decimal address', () => {
    fc.assert(
      fc.property(invalidIpv4Arbitrary(), (invalidIp) => {
        // Filter out strings that happen to be valid IPv6
        // (the validator accepts both IPv4 and IPv6 per the implementation)
        if (isLikelyValidIpv6(invalidIp)) return true; // skip

        expect(validateIpAddress(invalidIp)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject strings with non-numeric characters in octets', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringOf(fc.constantFrom('a', 'b', 'c', 'x', 'z', '!', '@', '#'), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ),
        ([alpha, b, c, d]) => {
          const ip = `${alpha}.${b}.${c}.${d}`;
          expect(validateIpAddress(ip)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject IPs with octets out of range (256+)', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 256, max: 9999 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 })
        ),
        ([a, b, c, d]) => {
          expect(validateIpAddress(`${a}.${b}.${c}.${d}`)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: cert-generation, Property 9: Invalid DNS Name Rejection', () => {
  /**
   * Validates: Requirements 3.8, 9.3
   *
   * For any empty string or string >253 chars, validateDnsName returns false.
   */
  it('should reject empty strings and strings exceeding 253 characters', () => {
    fc.assert(
      fc.property(invalidDnsNameArbitrary(), (invalidDns) => {
        expect(validateDnsName(invalidDns)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject DNS names containing invalid characters (non-whitespace)', () => {
    // Generate strings that contain at least one invalid character that is NOT whitespace.
    // Since validateDnsName trims input, whitespace-only invalidity is tested separately.
    const invalidCharDns = fc.tuple(
      fc.stringOf(fc.constantFrom('a', 'b', '1', '.', '-'), { minLength: 0, maxLength: 10 }),
      fc.constantFrom('!', '@', '#', '$', '_', '+', '~', '(', ')', '{', '}', '[', ']'),
      fc.stringOf(fc.constantFrom('a', 'b', '1', '.', '-'), { minLength: 0, maxLength: 10 })
    ).map(([prefix, invalid, suffix]) => `${prefix}${invalid}${suffix}`);

    fc.assert(
      fc.property(invalidCharDns, (invalidDns) => {
        expect(validateDnsName(invalidDns)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: cert-generation, Property 10: Invalid Country Code Rejection', () => {
  /**
   * Validates: Requirements 9.2
   *
   * For any string not exactly 2 uppercase ASCII letters,
   * validateCountryCode returns false.
   */
  it('should reject any string that is not exactly 2 uppercase ASCII letters', () => {
    fc.assert(
      fc.property(invalidCountryCodeArbitrary(), (invalidCode) => {
        expect(validateCountryCode(invalidCode)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject numeric-only strings of length 2', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 48, max: 57 }),
          fc.integer({ min: 48, max: 57 })
        ),
        ([a, b]) => {
          const code = String.fromCharCode(a) + String.fromCharCode(b);
          expect(validateCountryCode(code)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject strings with special characters', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*'), {
          minLength: 1,
          maxLength: 5,
        }),
        (code) => {
          expect(validateCountryCode(code)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: cert-generation, Property 11: Whitespace Trimming Idempotence', () => {
  /**
   * Validates: Requirements 9.4
   *
   * Trimmed inputs produce identical results to untrimmed equivalents.
   * Adding leading/trailing whitespace to valid inputs does not change validation outcome.
   */
  it('should produce the same IP validation result with or without surrounding whitespace', () => {
    fc.assert(
      fc.property(
        validIpv4Arbitrary(),
        whitespaceArbitrary(),
        whitespaceArbitrary(),
        (ip, leading, trailing) => {
          const withWhitespace = `${leading}${ip}${trailing}`;
          expect(validateIpAddress(withWhitespace)).toBe(validateIpAddress(ip));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce the same DNS validation result with or without surrounding whitespace', () => {
    fc.assert(
      fc.property(
        validDnsNameArbitrary(),
        whitespaceArbitrary(),
        whitespaceArbitrary(),
        (dns, leading, trailing) => {
          const withWhitespace = `${leading}${dns}${trailing}`;
          expect(validateDnsName(withWhitespace)).toBe(validateDnsName(dns));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce the same country code validation result with or without surrounding whitespace', () => {
    fc.assert(
      fc.property(
        validCountryCodeArbitrary(),
        whitespaceArbitrary(),
        whitespaceArbitrary(),
        (code, leading, trailing) => {
          const withWhitespace = `${leading}${code}${trailing}`;
          expect(validateCountryCode(withWhitespace)).toBe(validateCountryCode(code));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce identical validateGenerateRequest results with trimmed vs whitespace-padded inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          commonName: fc.option(
            fc.stringOf(fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C', '1', '2', ' '), {
              minLength: 1,
              maxLength: 30,
            }).filter((s) => s.trim().length >= 1 && s.trim().length <= 64),
            { nil: undefined }
          ),
          organization: fc.option(
            fc.stringOf(fc.constantFrom('O', 'r', 'g', ' ', '1'), {
              minLength: 1,
              maxLength: 30,
            }).filter((s) => s.trim().length >= 1 && s.trim().length <= 64),
            { nil: undefined }
          ),
          country: fc.option(validCountryCodeArbitrary(), { nil: undefined }),
          dnsNames: fc.option(
            fc.array(validDnsNameArbitrary(), { minLength: 1, maxLength: 3 }),
            { nil: undefined }
          ),
          ipAddresses: fc.option(
            fc.array(validIpv4Arbitrary(), { minLength: 1, maxLength: 3 }),
            { nil: undefined }
          ),
        }),
        whitespaceArbitrary(),
        whitespaceArbitrary(),
        (request, leading, trailing) => {
          // Build a version with whitespace padding
          const padded = {
            ...request,
            commonName: request.commonName
              ? `${leading}${request.commonName}${trailing}`
              : undefined,
            organization: request.organization
              ? `${leading}${request.organization}${trailing}`
              : undefined,
            country: request.country ? `${leading}${request.country}${trailing}` : undefined,
            dnsNames: request.dnsNames
              ? request.dnsNames.map((d) => `${leading}${d}${trailing}`)
              : undefined,
            ipAddresses: request.ipAddresses
              ? request.ipAddresses.map((ip) => `${leading}${ip}${trailing}`)
              : undefined,
          };

          const trimmedErrors = validateGenerateRequest(request);
          const paddedErrors = validateGenerateRequest(padded);

          // Both should have same number of errors (trimming makes them equivalent)
          expect(paddedErrors.length).toBe(trimmedErrors.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Helper ---

/** Quick check if a string could be a valid IPv6 (heuristic for filtering). */
function isLikelyValidIpv6(s: string): boolean {
  if (s.includes(':')) {
    // Basic IPv6 pattern check
    return /^[0-9a-fA-F:]+$/.test(s) || s === '::';
  }
  return false;
}

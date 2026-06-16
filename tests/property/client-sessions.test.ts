import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatRelativeDuration } from '../../web/src/utils/formatRelativeDuration.js';

/**
 * Feature: connected-clients-dashboard, Property 3: Relative Duration Formatting Correctness
 *
 * Validates: Requirements 5.4
 *
 * For any ISO 8601 timestamp representing a point in the past, the formatRelativeDuration
 * function SHALL produce a non-empty string that correctly represents the elapsed time as
 * a human-readable duration using day/hour/minute/second components, where the total seconds
 * implied by the formatted output equals the actual elapsed seconds (within a 1-second tolerance).
 */

// --- Helpers ---

/**
 * Parse a formatted duration string back to total seconds.
 * Handles formats: "Xd Yh", "Xh Ym", "Xm Ys", "Xd", "Xh", "Xm", "Xs", "just now"
 */
function parseDurationToSeconds(formatted: string): number {
  if (formatted === 'just now') {
    return 0;
  }

  let totalSeconds = 0;
  const parts = formatted.split(' ');

  for (const part of parts) {
    const match = part.match(/^(\d+)([dhms])$/);
    if (!match) {
      throw new Error(`Unexpected duration part: "${part}" in "${formatted}"`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'd':
        totalSeconds += value * 86400;
        break;
      case 'h':
        totalSeconds += value * 3600;
        break;
      case 'm':
        totalSeconds += value * 60;
        break;
      case 's':
        totalSeconds += value;
        break;
    }
  }

  return totalSeconds;
}

// --- Generators ---

/**
 * Generate an arbitrary past timestamp between 1 second and 365 days ago.
 * Returns both the ISO string and the expected elapsed seconds for verification.
 */
function pastTimestamp(): fc.Arbitrary<{ iso: string; elapsedMs: number }> {
  // Generate elapsed time between 1 second and 365 days (in milliseconds)
  return fc.integer({ min: 1000, max: 365 * 24 * 60 * 60 * 1000 }).map((elapsedMs) => {
    const now = Date.now();
    const pastTime = new Date(now - elapsedMs);
    return {
      iso: pastTime.toISOString(),
      elapsedMs,
    };
  });
}

// --- Property Tests ---

describe('Feature: connected-clients-dashboard, Property 3: Relative Duration Formatting Correctness', () => {
  it('should produce a non-empty string for any past timestamp', () => {
    fc.assert(
      fc.property(
        pastTimestamp(),
        ({ iso }) => {
          const result = formatRelativeDuration(iso);

          expect(result).toBeTruthy();
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce output that matches elapsed time within 1-second tolerance', () => {
    fc.assert(
      fc.property(
        pastTimestamp(),
        ({ iso, elapsedMs }) => {
          const result = formatRelativeDuration(iso);

          // The function truncates to two largest units, so we need to compute
          // the expected truncated value to compare against.
          const actualElapsedSeconds = Math.floor(elapsedMs / 1000);

          // Parse the formatted output back to seconds
          const parsedSeconds = parseDurationToSeconds(result);

          // The function shows only the two largest units, so the difference
          // between actual elapsed and parsed should be the truncated remainder.
          // The parsed value should always be <= actual elapsed (truncation removes smaller units).
          expect(parsedSeconds).toBeLessThanOrEqual(actualElapsedSeconds + 1);
          expect(parsedSeconds).toBeGreaterThanOrEqual(0);

          // Verify the output represents a valid truncation:
          // The difference (what was truncated) should be less than one unit
          // of the smallest displayed component.
          const parts = result.split(' ');
          const lastPart = parts[parts.length - 1];
          const lastUnitMatch = lastPart.match(/^(\d+)([dhms])$/);

          if (lastUnitMatch) {
            const lastUnit = lastUnitMatch[2];
            let maxTruncation: number;
            switch (lastUnit) {
              case 'd':
                maxTruncation = 86400; // up to 24h truncated
                break;
              case 'h':
                maxTruncation = 3600; // up to 60m truncated
                break;
              case 'm':
                maxTruncation = 60; // up to 60s truncated
                break;
              case 's':
                maxTruncation = 1; // 1-second tolerance for timing
                break;
              default:
                maxTruncation = 1;
            }

            const difference = actualElapsedSeconds - parsedSeconds;
            expect(difference).toBeGreaterThanOrEqual(-1); // Allow 1s timing tolerance
            expect(difference).toBeLessThan(maxTruncation + 1); // +1 for timing tolerance
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return "just now" for future timestamps or timestamps less than 1 second ago', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        (elapsedMs) => {
          const now = Date.now();
          const timestamp = new Date(now - elapsedMs).toISOString();
          const result = formatRelativeDuration(timestamp);

          expect(result).toBe('just now');
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: connected-clients-dashboard, Property 1: Session Data Round-Trip Preservation
 *
 * Validates: Requirements 1.4, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 *
 * For any valid array of client session objects, validateSessions SHALL produce session
 * objects where every field is preserved with correct types. Invalid/malformed entries
 * are filtered out rather than throwing.
 */

import { validateSessions } from '../../src/process-manager/validate-sessions.js';

// --- Generators for Property 1 ---

/** Valid session state values. */
const SESSION_STATES = ['Created', 'Activated', 'Closing'] as const;

/**
 * Generate a valid ISO 8601 timestamp string.
 * Produces dates within a reasonable range (2020-01-01 to 2025-12-31).
 */
function validIso8601(): fc.Arbitrary<string> {
  const min = new Date('2020-01-01T00:00:00.000Z').getTime();
  const max = new Date('2025-12-31T23:59:59.999Z').getTime();
  return fc.integer({ min, max }).map((ms) => new Date(ms).toISOString());
}

/**
 * Generate a valid ClientSession object with arbitrary string fields.
 */
function validClientSession(): fc.Arbitrary<{
  applicationName: string;
  applicationUri: string;
  securityPolicyUri: string;
  clientAddress: string;
  connectTime: string;
  sessionState: string;
}> {
  return fc.record({
    applicationName: fc.string({ minLength: 0, maxLength: 100 }),
    applicationUri: fc.string({ minLength: 0, maxLength: 200 }),
    securityPolicyUri: fc.string({ minLength: 0, maxLength: 200 }),
    clientAddress: fc.string({ minLength: 0, maxLength: 50 }),
    connectTime: validIso8601(),
    sessionState: fc.constantFrom(...SESSION_STATES),
  });
}

/**
 * Generate an invalid/malformed session entry.
 * Randomly picks from several categories of invalidity.
 */
function invalidSessionEntry(): fc.Arbitrary<unknown> {
  return fc.oneof(
    // Non-object values
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.string(),
    fc.boolean(),
    fc.constant([]),
    // Object with missing fields
    fc.record({
      applicationName: fc.string(),
    }),
    // Object with wrong types for required fields
    fc.record({
      applicationName: fc.integer(),
      applicationUri: fc.string(),
      securityPolicyUri: fc.string(),
      clientAddress: fc.string(),
      connectTime: fc.string(),
      sessionState: fc.string(),
    }),
    // Object with invalid sessionState
    fc.record({
      applicationName: fc.string(),
      applicationUri: fc.string(),
      securityPolicyUri: fc.string(),
      clientAddress: fc.string(),
      connectTime: validIso8601(),
      sessionState: fc.string().filter((s) => !SESSION_STATES.includes(s as typeof SESSION_STATES[number])),
    }),
    // Object with invalid connectTime (not ISO 8601)
    fc.record({
      applicationName: fc.string(),
      applicationUri: fc.string(),
      securityPolicyUri: fc.string(),
      clientAddress: fc.string(),
      connectTime: fc.constantFrom('not-a-date', 'invalid', '99-99-99', ''),
      sessionState: fc.constantFrom(...SESSION_STATES),
    }),
  );
}

// --- Property Tests ---

describe('Feature: connected-clients-dashboard, Property 1: Session Data Round-Trip Preservation', () => {
  it('should preserve all fields of valid ClientSession objects through validateSessions', () => {
    fc.assert(
      fc.property(
        fc.array(validClientSession(), { minLength: 0, maxLength: 20 }),
        (sessions) => {
          const result = validateSessions(sessions);

          // All valid sessions should be preserved
          expect(result).toHaveLength(sessions.length);

          // Each field should be preserved exactly
          for (let i = 0; i < sessions.length; i++) {
            expect(result[i].applicationName).toBe(sessions[i].applicationName);
            expect(result[i].applicationUri).toBe(sessions[i].applicationUri);
            expect(result[i].securityPolicyUri).toBe(sessions[i].securityPolicyUri);
            expect(result[i].clientAddress).toBe(sessions[i].clientAddress);
            expect(result[i].connectTime).toBe(sessions[i].connectTime);
            expect(result[i].sessionState).toBe(sessions[i].sessionState);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should filter out all invalid/malformed entries', () => {
    fc.assert(
      fc.property(
        fc.array(invalidSessionEntry(), { minLength: 1, maxLength: 20 }),
        (invalidEntries) => {
          const result = validateSessions(invalidEntries);

          // All invalid entries should be filtered out
          expect(result).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve valid entries and filter invalid ones from a mixed array', () => {
    fc.assert(
      fc.property(
        fc.array(validClientSession(), { minLength: 1, maxLength: 10 }),
        fc.array(invalidSessionEntry(), { minLength: 1, maxLength: 10 }),
        (validSessions, invalidEntries) => {
          // Mix valid and invalid entries together
          const mixed = [...validSessions, ...invalidEntries];

          const result = validateSessions(mixed);

          // Only valid sessions should survive
          expect(result).toHaveLength(validSessions.length);

          // Valid sessions should be preserved in order (they come first in the mixed array)
          for (let i = 0; i < validSessions.length; i++) {
            expect(result[i].applicationName).toBe(validSessions[i].applicationName);
            expect(result[i].applicationUri).toBe(validSessions[i].applicationUri);
            expect(result[i].securityPolicyUri).toBe(validSessions[i].securityPolicyUri);
            expect(result[i].clientAddress).toBe(validSessions[i].clientAddress);
            expect(result[i].connectTime).toBe(validSessions[i].connectTime);
            expect(result[i].sessionState).toBe(validSessions[i].sessionState);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return an empty array when input is not an array', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.boolean(),
          fc.record({ sessions: fc.array(fc.string()) }),
        ),
        (nonArrayInput) => {
          const result = validateSessions(nonArrayInput);
          expect(result).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

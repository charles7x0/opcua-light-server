import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 8: Status write occurs if and only if state changed
 *
 * For any two consecutive invocations of `status_write_if_changed` with session
 * state S1 and S2: if S1 equals S2, the file shall not be rewritten; if S1 differs
 * from S2, the file shall be written with the new state.
 *
 * **Validates: Requirements 8.2, 8.3**
 */

/* ─── TypeScript reimplementation of the C change detection algorithm ─────── */

interface SessionState {
  connectedClients: number;
  sessions: Array<{
    applicationName: string;
    applicationUri: string;
    securityPolicyUri: string;
    clientAddress: string;
    connectTime: string;
    sessionState: string;
  }>;
}

/**
 * Mirrors the change detection logic from status_writer.c:
 *
 * ```c
 * char *json_str = cJSON_PrintUnformatted(root);
 * if (ctx->last_status_json != NULL && strcmp(json_str, ctx->last_status_json) == 0) {
 *     free(json_str);
 *     return;  // no write
 * }
 * free(ctx->last_status_json);
 * ctx->last_status_json = json_str;
 * // ... write file ...
 * ```
 */
class StatusWriter {
  private lastStatusJson: string | null = null;

  /**
   * Returns true if a file write occurred, false if skipped due to no change.
   */
  writeIfChanged(currentState: StatusState): boolean {
    const json = JSON.stringify(currentState);
    if (this.lastStatusJson !== null && json === this.lastStatusJson) {
      return false; // no write — state unchanged
    }
    this.lastStatusJson = json;
    return true; // file written
  }
}

type StatusState = SessionState;

/* ─── Generators ─────────────────────────────────────────────────────────── */

const sessionStateNames = ['Created', 'Activated', 'Closing'];

const sessionArb = fc.record({
  applicationName: fc.string({ minLength: 0, maxLength: 50 }),
  applicationUri: fc.string({ minLength: 0, maxLength: 100 }),
  securityPolicyUri: fc.constantFrom(
    'http://opcfoundation.org/UA/SecurityPolicy#None',
    'http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256',
    'http://opcfoundation.org/UA/SecurityPolicy#Aes128_Sha256_RsaOaep'
  ),
  clientAddress: fc.tuple(
    fc.ipV4(),
    fc.integer({ min: 1024, max: 65535 })
  ).map(([ip, port]) => `${ip}:${port}`),
  connectTime: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString()),
  sessionState: fc.constantFrom(...sessionStateNames),
});

const statusStateArb: fc.Arbitrary<StatusState> = fc.record({
  connectedClients: fc.integer({ min: 0, max: 100 }),
  sessions: fc.array(sessionArb, { minLength: 0, maxLength: 10 }),
});

/* ─── Property Tests ─────────────────────────────────────────────────────── */

describe('Feature: runtime-modular-refactor, Property 8: Status write occurs if and only if state changed', () => {
  it('first invocation always writes (last_status_json is null)', () => {
    fc.assert(
      fc.property(statusStateArb, (state) => {
        const writer = new StatusWriter();
        const wrote = writer.writeIfChanged(state);
        expect(wrote).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('identical consecutive states do not trigger a write', () => {
    fc.assert(
      fc.property(statusStateArb, (state) => {
        const writer = new StatusWriter();

        // First call writes
        writer.writeIfChanged(state);

        // Second call with same state does not write
        const wrote = writer.writeIfChanged(state);
        expect(wrote).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('different states always trigger a write', () => {
    fc.assert(
      fc.property(
        statusStateArb,
        statusStateArb.filter((s) => true), // generate a second state
        (state1, state2) => {
          // Only test when the two states actually differ (by JSON serialization)
          fc.pre(JSON.stringify(state1) !== JSON.stringify(state2));

          const writer = new StatusWriter();

          // First call writes state1
          writer.writeIfChanged(state1);

          // Second call with different state2 writes
          const wrote = writer.writeIfChanged(state2);
          expect(wrote).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('after a write, calling again with the same state does not write', () => {
    fc.assert(
      fc.property(
        statusStateArb,
        statusStateArb,
        fc.integer({ min: 1, max: 5 }),
        (state1, state2, repeatCount) => {
          fc.pre(JSON.stringify(state1) !== JSON.stringify(state2));

          const writer = new StatusWriter();

          // Write state1
          expect(writer.writeIfChanged(state1)).toBe(true);

          // Write state2 (different, should write)
          expect(writer.writeIfChanged(state2)).toBe(true);

          // Repeat state2 multiple times — none should write
          for (let i = 0; i < repeatCount; i++) {
            expect(writer.writeIfChanged(state2)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

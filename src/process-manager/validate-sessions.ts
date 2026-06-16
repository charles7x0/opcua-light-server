import type { ClientSession, ClientSessionState } from '../types/index.js';

/** Valid session state values. */
const VALID_SESSION_STATES: ReadonlySet<ClientSessionState> = new Set([
  'Created',
  'Activated',
  'Closing',
]);

/**
 * Check whether a string is a valid ISO 8601 date
 * (parseable by `new Date()` without producing NaN).
 */
function isValidIso8601(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * Type guard: checks if a value is a non-null object (not an array).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate and filter raw session data from status.json.
 *
 * Accepts `unknown` input (the raw `sessions` field) and returns
 * only valid `ClientSession` objects. Invalid entries are silently
 * filtered out rather than throwing.
 */
export function validateSessions(raw: unknown): ClientSession[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const results: ClientSession[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const { applicationName, applicationUri, securityPolicyUri, clientAddress, connectTime, sessionState } = entry;

    // All fields must be strings
    if (
      typeof applicationName !== 'string' ||
      typeof applicationUri !== 'string' ||
      typeof securityPolicyUri !== 'string' ||
      typeof clientAddress !== 'string' ||
      typeof connectTime !== 'string' ||
      typeof sessionState !== 'string'
    ) {
      continue;
    }

    // sessionState must be a valid value
    if (!VALID_SESSION_STATES.has(sessionState as ClientSessionState)) {
      continue;
    }

    // connectTime must be a valid ISO 8601 date
    if (!isValidIso8601(connectTime)) {
      continue;
    }

    results.push({
      applicationName,
      applicationUri,
      securityPolicyUri,
      clientAddress,
      connectTime,
      sessionState: sessionState as ClientSessionState,
    });
  }

  return results;
}

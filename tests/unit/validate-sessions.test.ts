import { describe, it, expect } from 'vitest';
import { validateSessions } from '../../src/process-manager/validate-sessions.js';

describe('validateSessions', () => {
  const validSession = {
    applicationName: 'UaExpert',
    applicationUri: 'urn:UnifiedAutomation:UaExpert',
    securityPolicyUri: 'http://opcfoundation.org/UA/SecurityPolicy#None',
    clientAddress: '192.168.1.50:54321',
    connectTime: '2024-01-15T10:30:00.000Z',
    sessionState: 'Activated',
  };

  it('returns empty array if input is not an array', () => {
    expect(validateSessions(null)).toEqual([]);
    expect(validateSessions(undefined)).toEqual([]);
    expect(validateSessions('string')).toEqual([]);
    expect(validateSessions(42)).toEqual([]);
    expect(validateSessions({})).toEqual([]);
  });

  it('returns empty array for an empty array input', () => {
    expect(validateSessions([])).toEqual([]);
  });

  it('returns valid sessions unchanged', () => {
    const result = validateSessions([validSession]);
    expect(result).toEqual([validSession]);
  });

  it('accepts all valid session states', () => {
    for (const state of ['Created', 'Activated', 'Closing']) {
      const session = { ...validSession, sessionState: state };
      const result = validateSessions([session]);
      expect(result).toHaveLength(1);
      expect(result[0].sessionState).toBe(state);
    }
  });

  it('filters out entries with invalid sessionState', () => {
    const invalid = { ...validSession, sessionState: 'Invalid' };
    expect(validateSessions([invalid])).toEqual([]);
  });

  it('filters out entries with invalid connectTime', () => {
    const invalid = { ...validSession, connectTime: 'not-a-date' };
    expect(validateSessions([invalid])).toEqual([]);
  });

  it('filters out entries missing required fields', () => {
    const { applicationName, ...missing } = validSession;
    expect(validateSessions([missing])).toEqual([]);
  });

  it('filters out entries with non-string field types', () => {
    const invalid = { ...validSession, applicationName: 123 };
    expect(validateSessions([invalid])).toEqual([]);
  });

  it('filters out non-object entries', () => {
    expect(validateSessions([null, undefined, 42, 'str', true])).toEqual([]);
  });

  it('preserves valid entries and filters invalid ones', () => {
    const invalid = { ...validSession, sessionState: 'Unknown' };
    const result = validateSessions([validSession, invalid, validSession]);
    expect(result).toHaveLength(2);
  });
});

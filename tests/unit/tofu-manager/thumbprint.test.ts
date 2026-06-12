import { describe, it, expect } from 'vitest';
import { isValidThumbprint } from '../../../src/tofu-manager/index.js';

describe('isValidThumbprint', () => {
  it('accepts a valid 40-character lowercase hex string', () => {
    expect(isValidThumbprint('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(true);
  });

  it('accepts all-zeros thumbprint', () => {
    expect(isValidThumbprint('0000000000000000000000000000000000000000')).toBe(true);
  });

  it('accepts all hex digits (0-9, a-f)', () => {
    expect(isValidThumbprint('0123456789abcdef0123456789abcdef01234567')).toBe(true);
  });

  it('rejects uppercase hex characters', () => {
    expect(isValidThumbprint('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2')).toBe(false);
  });

  it('rejects mixed-case hex characters', () => {
    expect(isValidThumbprint('a1b2c3d4e5f6A1B2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(false);
  });

  it('rejects strings shorter than 40 characters', () => {
    expect(isValidThumbprint('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b')).toBe(false);
  });

  it('rejects strings longer than 40 characters', () => {
    expect(isValidThumbprint('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2a')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidThumbprint('')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidThumbprint('g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(false);
  });

  it('rejects strings with spaces', () => {
    expect(isValidThumbprint('a1b2c3d4 5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(false);
  });

  it('rejects strings with special characters', () => {
    expect(isValidThumbprint('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1-2')).toBe(false);
  });
});

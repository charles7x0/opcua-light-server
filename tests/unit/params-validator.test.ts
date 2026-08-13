import { describe, it, expect } from 'vitest';
import { validateParams } from '../../src/connectors/params-validator.js';
import { ParamFieldSchema } from '../../src/connectors/types.js';

describe('validateParams', () => {
  describe('text fields', () => {
    const textSchema: ParamFieldSchema[] = [
      { key: 'host', label: 'Host', type: 'text', required: true },
    ];

    it('accepts a valid string value', () => {
      const result = validateParams({ host: '192.168.1.10' }, textSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects a non-string value', () => {
      const result = validateParams({ host: 12345 }, textSchema);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('host');
      expect(result.errors[0].message).toContain('must be a string');
    });
  });

  describe('number fields', () => {
    const numberSchema: ParamFieldSchema[] = [
      { key: 'port', label: 'Port', type: 'number', required: true, min: 1, max: 65535 },
    ];

    it('accepts a valid number value', () => {
      const result = validateParams({ port: 502 }, numberSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a string parseable to number', () => {
      const result = validateParams({ port: '8080' }, numberSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects a non-parseable string', () => {
      const result = validateParams({ port: 'abc' }, numberSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('port');
      expect(result.errors[0].message).toContain('must be a valid number');
    });

    it('rejects a value below min', () => {
      const result = validateParams({ port: 0 }, numberSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('port');
      expect(result.errors[0].message).toContain('must be at least 1');
    });

    it('rejects a value above max', () => {
      const result = validateParams({ port: 70000 }, numberSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('port');
      expect(result.errors[0].message).toContain('must be at most 65535');
    });
  });

  describe('boolean fields', () => {
    const boolSchema: ParamFieldSchema[] = [
      { key: 'enabled', label: 'Enabled', type: 'boolean', required: true },
    ];

    it('accepts true', () => {
      const result = validateParams({ enabled: true }, boolSchema);
      expect(result.valid).toBe(true);
    });

    it('accepts false', () => {
      const result = validateParams({ enabled: false }, boolSchema);
      expect(result.valid).toBe(true);
    });

    it('accepts string "true"', () => {
      const result = validateParams({ enabled: 'true' }, boolSchema);
      expect(result.valid).toBe(true);
    });

    it('accepts string "false"', () => {
      const result = validateParams({ enabled: 'false' }, boolSchema);
      expect(result.valid).toBe(true);
    });

    it('rejects other values', () => {
      const result = validateParams({ enabled: 'yes' }, boolSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('enabled');
      expect(result.errors[0].message).toContain('must be a boolean');
    });
  });

  describe('select fields', () => {
    const selectSchema: ParamFieldSchema[] = [
      {
        key: 'protocol',
        label: 'Protocol',
        type: 'select',
        required: true,
        options: [
          { value: 'tcp', label: 'TCP' },
          { value: 'rtu', label: 'RTU' },
        ],
      },
    ];

    it('accepts a valid option value', () => {
      const result = validateParams({ protocol: 'tcp' }, selectSchema);
      expect(result.valid).toBe(true);
    });

    it('rejects an invalid option value', () => {
      const result = validateParams({ protocol: 'udp' }, selectSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('protocol');
      expect(result.errors[0].message).toContain('must be one of');
    });
  });

  describe('required fields', () => {
    const requiredSchema: ParamFieldSchema[] = [
      { key: 'host', label: 'Host', type: 'text', required: true },
    ];

    it('returns invalid when a required field is missing', () => {
      const result = validateParams({}, requiredSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('host');
      expect(result.errors[0].message).toContain('is required');
    });

    it('returns invalid when a required field is empty string', () => {
      const result = validateParams({ host: '' }, requiredSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('is required');
    });

    it('returns invalid when a required field is null', () => {
      const result = validateParams({ host: null }, requiredSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('is required');
    });
  });

  describe('optional fields', () => {
    const optionalSchema: ParamFieldSchema[] = [
      { key: 'description', label: 'Description', type: 'text', required: false },
    ];

    it('skips validation when optional field is missing', () => {
      const result = validateParams({}, optionalSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('skips validation when optional field is empty string', () => {
      const result = validateParams({ description: '' }, optionalSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('pattern matching', () => {
    const patternSchema: ParamFieldSchema[] = [
      {
        key: 'ip',
        label: 'IP Address',
        type: 'text',
        required: true,
        pattern: '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$',
        patternMessage: 'Must be a valid IPv4 address',
      },
    ];

    it('accepts a value matching the pattern', () => {
      const result = validateParams({ ip: '192.168.1.1' }, patternSchema);
      expect(result.valid).toBe(true);
    });

    it('rejects a value not matching the pattern and returns patternMessage', () => {
      const result = validateParams({ ip: 'not-an-ip' }, patternSchema);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('ip');
      expect(result.errors[0].message).toBe('Must be a valid IPv4 address');
    });

    it('uses default message when patternMessage is not provided', () => {
      const schemaNoMsg: ParamFieldSchema[] = [
        {
          key: 'code',
          label: 'Code',
          type: 'text',
          required: true,
          pattern: '^[A-Z]+$',
        },
      ];
      const result = validateParams({ code: '123' }, schemaNoMsg);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('does not match the required pattern');
    });
  });

  describe('unknown fields (backward compatibility)', () => {
    const schema: ParamFieldSchema[] = [
      { key: 'host', label: 'Host', type: 'text', required: true },
    ];

    it('ignores unknown extra fields in params', () => {
      const result = validateParams(
        { host: '192.168.1.1', unknownField: 'value', anotherExtra: 42 },
        schema
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('empty params with no required fields', () => {
    const schema: ParamFieldSchema[] = [
      { key: 'rack', label: 'Rack', type: 'number', required: false },
      { key: 'slot', label: 'Slot', type: 'number', required: false },
    ];

    it('returns valid for empty params when no fields are required', () => {
      const result = validateParams({}, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

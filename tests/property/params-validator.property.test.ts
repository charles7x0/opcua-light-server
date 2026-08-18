import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateParams } from '../../src/connectors/core/params-validator.js';
import type { ParamFieldSchema } from '../../src/connectors/core/types.js';

/**
 * Feature: connector-plugin-architecture
 * Property 5: Params validation against paramsSchema
 *
 * Validates: Requirements 9.1, 9.2
 */

// --- Arbitraries ---

/** Generate a valid field key (alphanumeric, no spaces). */
const arbFieldKey = fc.string({ minLength: 1, maxLength: 20 }).map((s) =>
  s.replace(/[^a-zA-Z0-9_]/g, 'x').replace(/^[^a-zA-Z]/, 'f')
).filter((s) => s.length >= 1);

/** Generate a non-empty label. */
const arbLabel = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** Generate a text field schema. */
const arbTextFieldSchema: fc.Arbitrary<ParamFieldSchema> = fc.record({
  key: arbFieldKey,
  label: arbLabel,
  type: fc.constant('text' as const),
  required: fc.boolean(),
});

/** Generate a number field schema with optional min/max. */
const arbNumberFieldSchema: fc.Arbitrary<ParamFieldSchema> = fc.record({
  key: arbFieldKey,
  label: arbLabel,
  type: fc.constant('number' as const),
  required: fc.boolean(),
  min: fc.option(fc.integer({ min: -10000, max: 10000 }), { nil: undefined }),
  max: fc.option(fc.integer({ min: -10000, max: 10000 }), { nil: undefined }),
}).map((field) => {
  // Ensure min <= max when both are defined
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    const temp = field.min;
    field.min = field.max;
    field.max = temp;
  }
  return field;
});

/** Generate a boolean field schema. */
const arbBooleanFieldSchema: fc.Arbitrary<ParamFieldSchema> = fc.record({
  key: arbFieldKey,
  label: arbLabel,
  type: fc.constant('boolean' as const),
  required: fc.boolean(),
});

/** Generate a select field schema with options. */
const arbSelectFieldSchema: fc.Arbitrary<ParamFieldSchema> = fc.record({
  key: arbFieldKey,
  label: arbLabel,
  type: fc.constant('select' as const),
  required: fc.boolean(),
  options: fc.array(
    fc.record({
      value: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
      label: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    }),
    { minLength: 1, maxLength: 5 }
  ),
});

/** Generate any kind of field schema. */
const arbFieldSchema: fc.Arbitrary<ParamFieldSchema> = fc.oneof(
  arbTextFieldSchema,
  arbNumberFieldSchema,
  arbBooleanFieldSchema,
  arbSelectFieldSchema
);

/** Generate a schema array with unique keys. */
const arbSchema: fc.Arbitrary<ParamFieldSchema[]> = fc
  .array(arbFieldSchema, { minLength: 1, maxLength: 8 })
  .map((fields) => {
    // Deduplicate by key
    const seen = new Set<string>();
    return fields.filter((f) => {
      if (seen.has(f.key)) return false;
      seen.add(f.key);
      return true;
    });
  })
  .filter((arr) => arr.length >= 1);

/** Generate a valid value for a given field schema. */
function arbValidValueForField(field: ParamFieldSchema): fc.Arbitrary<unknown> {
  switch (field.type) {
    case 'text':
      return fc.string({ minLength: 1, maxLength: 50 });
    case 'number': {
      const min = field.min ?? -10000;
      const max = field.max ?? 10000;
      return fc.integer({ min, max });
    }
    case 'boolean':
      return fc.boolean();
    case 'select': {
      const values = field.options?.map((o) => o.value) ?? ['default'];
      return fc.constantFrom(...values);
    }
    default:
      return fc.string({ minLength: 1, maxLength: 20 });
  }
}

/** Generate a params object that satisfies all required fields in the schema. */
function arbValidParams(schema: ParamFieldSchema[]): fc.Arbitrary<Record<string, unknown>> {
  if (schema.length === 0) return fc.constant({});

  const entries = schema.map((field) => ({
    key: field.key,
    valueArb: arbValidValueForField(field),
  }));

  return fc.tuple(...entries.map((e) => e.valueArb)).map((values) => {
    const params: Record<string, unknown> = {};
    entries.forEach((entry, i) => {
      params[entry.key] = values[i];
    });
    return params;
  });
}

describe('Feature: connector-plugin-architecture, Property 5: Params validation against paramsSchema', () => {
  /**
   * Validates: Requirements 9.1, 9.2
   *
   * For any schema where all required fields in params have correct types,
   * the result SHALL be valid.
   */
  it('should accept params where all required fields are present with correct types', () => {
    fc.assert(
      fc.property(arbSchema, (schema) => {
        // Generate valid params synchronously using a sample
        const params: Record<string, unknown> = {};
        for (const field of schema) {
          switch (field.type) {
            case 'text':
              params[field.key] = 'validText';
              break;
            case 'number': {
              // Pick a value safely within bounds
              if (field.min !== undefined && field.max !== undefined) {
                params[field.key] = Math.floor((field.min + field.max) / 2);
              } else if (field.min !== undefined) {
                params[field.key] = field.min;
              } else if (field.max !== undefined) {
                params[field.key] = field.max;
              } else {
                params[field.key] = 0;
              }
              break;
            }
            case 'boolean':
              params[field.key] = true;
              break;
            case 'select':
              params[field.key] = field.options?.[0]?.value ?? 'default';
              break;
          }
        }

        const result = validateParams(params, schema);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 9.1, 9.2
   *
   * For any schema with at least one required field, removing that field
   * from params SHALL result in an invalid validation with an error for that field.
   */
  it('should reject params where a required field is missing', () => {
    const arbSchemaWithRequired = arbSchema
      .map((schema) => schema.map((f) => ({ ...f, required: true })))
      .filter((schema) => schema.length >= 1);

    fc.assert(
      fc.property(arbSchemaWithRequired, (schema) => {
        // Pick the first required field to remove
        const removedField = schema[0];

        // Build valid params for all fields except the removed one
        const params: Record<string, unknown> = {};
        for (const field of schema) {
          if (field.key === removedField.key) continue;
          switch (field.type) {
            case 'text':
              params[field.key] = 'validText';
              break;
            case 'number': {
              const min = field.min ?? 0;
              const max = field.max ?? 100;
              params[field.key] = Math.floor((min + max) / 2);
              break;
            }
            case 'boolean':
              params[field.key] = true;
              break;
            case 'select':
              params[field.key] = field.options?.[0]?.value ?? 'default';
              break;
          }
        }

        const result = validateParams(params, schema);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(1);

        const fieldNames = result.errors.map((e) => e.field);
        expect(fieldNames).toContain(removedField.key);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 9.1, 9.2
   *
   * For any number field with min/max constraints, a value outside the bounds
   * SHALL result in an invalid validation.
   */
  it('should reject number fields with values outside min/max bounds', () => {
    const arbNumberSchemaWithBounds = arbNumberFieldSchema
      .map((field) => ({ ...field, required: true }))
      .filter((field) => field.min !== undefined || field.max !== undefined);

    fc.assert(
      fc.property(
        arbNumberSchemaWithBounds,
        fc.boolean(), // true = violate min, false = violate max
        (field, violateMin) => {
          const schema: ParamFieldSchema[] = [field];
          let invalidValue: number;

          if (violateMin && field.min !== undefined) {
            invalidValue = field.min - 1;
          } else if (!violateMin && field.max !== undefined) {
            invalidValue = field.max + 1;
          } else if (field.min !== undefined) {
            invalidValue = field.min - 1;
          } else if (field.max !== undefined) {
            invalidValue = field.max + 1;
          } else {
            // No bounds to violate — skip
            return;
          }

          const params: Record<string, unknown> = { [field.key]: invalidValue };
          const result = validateParams(params, schema);

          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);

          const fieldNames = result.errors.map((e) => e.field);
          expect(fieldNames).toContain(field.key);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 9.1, 9.2
   *
   * For any text field with a pattern constraint, a value not matching the pattern
   * SHALL result in an invalid validation.
   */
  it('should reject text fields with values not matching pattern', () => {
    // Use specific patterns that are easy to generate violations for
    const arbPatternField: fc.Arbitrary<ParamFieldSchema> = fc.record({
      key: arbFieldKey,
      label: arbLabel,
      type: fc.constant('text' as const),
      required: fc.constant(true),
      pattern: fc.constantFrom(
        '^\\d+$',           // only digits
        '^[a-z]+$',         // only lowercase
        '^[A-Z]+$',         // only uppercase
        '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$', // IP-like
      ),
    });

    // Values that don't match any of the above patterns
    const arbNonMatchingValue = fc.constantFrom(
      'abc!@#',
      'UPPER123',
      'mixed Case',
      'not-an-ip',
      '!!!',
      'hello world',
    );

    fc.assert(
      fc.property(arbPatternField, arbNonMatchingValue, (field, value) => {
        // Verify the value actually doesn't match the pattern
        const regex = new RegExp(field.pattern!);
        if (regex.test(value)) return; // Skip if accidentally matches

        const schema: ParamFieldSchema[] = [field];
        const params: Record<string, unknown> = { [field.key]: value };
        const result = validateParams(params, schema);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(1);

        const fieldNames = result.errors.map((e) => e.field);
        expect(fieldNames).toContain(field.key);
      }),
      { numRuns: 100 }
    );
  });
});

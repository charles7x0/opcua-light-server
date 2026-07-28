import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Property 7: Initial value creation preserves type and value
 *
 * For any supported numeric type name and for any numeric value representable in that type,
 * calling `create_initial_value(type, json_value)` shall produce a UA_Variant whose data type
 * matches the table entry's UA_TYPES index and whose stored value equals the input value
 * (within floating-point precision for Float/Double). For any string value, the resulting
 * UA_String shall contain the same characters as the input.
 *
 * **Validates: Requirements 7.3, 7.5**
 */
describe('Feature: runtime-modular-refactor, Property 7: Initial value creation preserves type and value', () => {
  const runtimeDir = path.resolve(__dirname, '../../runtime');
  const helperSrc = path.join(runtimeDir, 'src/address_space/test_initial_value_helper.c');
  const helperBin = path.join(runtimeDir, 'build/test_initial_value_helper.exe');

  beforeAll(() => {
    if (!existsSync(helperBin)) {
      const buildDir = path.join(runtimeDir, 'build');
      if (!existsSync(buildDir)) {
        mkdirSync(buildDir, { recursive: true });
      }

      execFileSync('gcc', [
        '-Wall', '-Wextra',
        helperSrc,
        '-o', helperBin,
      ], {
        cwd: runtimeDir,
        timeout: 30000,
      });
    }

    expect(existsSync(helperBin)).toBe(true);
  });

  /** Expected UA_TYPES indices for each type name */
  const TYPE_MAP: Record<string, number> = {
    'Boolean': 0,
    'Int16': 2,
    'Int32': 4,
    'Int64': 6,
    'UInt16': 3,
    'UInt32': 5,
    'UInt64': 7,
    'Float': 8,
    'Double': 9,
    'String': 11,
    'DateTime': 12,
    'ByteString': 14,
  };

  interface TestCase {
    dataType: string;
    jsonValue: string;
  }

  interface HelperResult {
    typeIndex: number;
    typeName: string;
    value: unknown;
  }

  /**
   * Invoke the helper in batch mode: send all test cases via stdin,
   * parse all result lines from stdout. Much faster than spawning per-case.
   */
  function invokeBatch(cases: TestCase[]): HelperResult[] {
    const input = cases.map((c) => `${c.dataType}\t${c.jsonValue}`).join('\n') + '\n';

    const result = spawnSync(helperBin, [], {
      input,
      encoding: 'utf-8',
      timeout: 15000,
    });

    if (result.status !== 0) {
      throw new Error(`Helper exited with status ${result.status}: ${result.stderr}`);
    }

    const lines = result.stdout.trim().split('\n').filter((l) => l.length > 0);
    if (lines.length !== cases.length) {
      throw new Error(`Expected ${cases.length} results, got ${lines.length}`);
    }

    return lines.map((line) => {
      const parsed = JSON.parse(line.trim());
      return {
        typeIndex: parsed.type_index,
        typeName: parsed.type_name,
        value: parsed.value,
      };
    });
  }

  it('numeric integer types preserve type_index and truncated value', () => {
    // Generate all test cases up front using fc.sample
    const integerTypes = [
      { name: 'Int16', min: -32768, max: 32767 },
      { name: 'Int32', min: -2147483648, max: 2147483647 },
      { name: 'UInt16', min: 0, max: 65535 },
      { name: 'UInt32', min: 0, max: 4294967295 },
    ];

    const samples = fc.sample(
      fc.record({
        typeIdx: fc.integer({ min: 0, max: integerTypes.length - 1 }),
        rawValue: fc.double({ min: -2147483648, max: 4294967295, noNaN: true, noDefaultInfinity: true }),
      }),
      100
    );

    const cases: TestCase[] = samples.map((s) => {
      const typeInfo = integerTypes[s.typeIdx];
      const clampedValue = Math.max(typeInfo.min, Math.min(typeInfo.max, Math.trunc(s.rawValue)));
      // Avoid -0 which JavaScript produces from Math.trunc but C integers don't distinguish
      const jsonValue = Object.is(clampedValue, -0) ? '0' : clampedValue.toString();
      return { dataType: typeInfo.name, jsonValue };
    });

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const typeInfo = integerTypes[samples[i].typeIdx];
      const clampedValue = Math.max(typeInfo.min, Math.min(typeInfo.max, Math.trunc(samples[i].rawValue)));
      const result = results[i];

      expect(result.typeIndex).toBe(TYPE_MAP[typeInfo.name]);
      // Compare as numbers: Object.is(-0, 0) is false, but they represent the same integer value
      expect(result.value).toBe(Object.is(clampedValue, -0) ? 0 : clampedValue);
    }
  });

  it('Int64 and UInt64 preserve type_index and truncated value within safe integer range', () => {
    const int64Types = [
      { name: 'Int64', min: -(2 ** 53 - 1), max: 2 ** 53 - 1 },
      { name: 'UInt64', min: 0, max: 2 ** 53 - 1 },
    ];

    const samples = fc.sample(
      fc.record({
        typeIdx: fc.integer({ min: 0, max: int64Types.length - 1 }),
        rawValue: fc.double({ min: 0, max: 2 ** 53 - 1, noNaN: true, noDefaultInfinity: true }),
      }),
      100
    );

    const cases: TestCase[] = samples.map((s) => {
      const typeInfo = int64Types[s.typeIdx];
      const value = typeInfo.name === 'Int64'
        ? Math.trunc(s.rawValue - (2 ** 52))
        : Math.trunc(s.rawValue);
      const clampedValue = Math.max(typeInfo.min, Math.min(typeInfo.max, value));
      return { dataType: typeInfo.name, jsonValue: clampedValue.toString() };
    });

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const typeInfo = int64Types[samples[i].typeIdx];
      const value = typeInfo.name === 'Int64'
        ? Math.trunc(samples[i].rawValue - (2 ** 52))
        : Math.trunc(samples[i].rawValue);
      const clampedValue = Math.max(typeInfo.min, Math.min(typeInfo.max, value));
      const result = results[i];

      expect(result.typeIndex).toBe(TYPE_MAP[typeInfo.name]);
      expect(result.value).toBe(clampedValue);
    }
  });

  it('Float preserves type_index and value within float precision', () => {
    const samples = fc.sample(
      fc.float({ noNaN: true, noDefaultInfinity: true }),
      100
    );

    const cases: TestCase[] = samples.map((v) => ({
      dataType: 'Float',
      jsonValue: v.toString(),
    }));

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const result = results[i];
      const rawValue = samples[i];

      expect(result.typeIndex).toBe(TYPE_MAP['Float']);

      // Float has ~7 decimal digits of precision
      const expectedFloat = Math.fround(rawValue);
      if (expectedFloat === 0) {
        expect(Math.abs(result.value as number)).toBeLessThanOrEqual(Number.EPSILON);
      } else {
        const relError = Math.abs((result.value as number) - expectedFloat) / Math.abs(expectedFloat);
        expect(relError).toBeLessThan(1e-6);
      }
    }
  });

  it('Double preserves type_index and value exactly', () => {
    // Generate doubles from integers divided by powers of 10 to ensure clean
    // string representation that round-trips through toString() → atof() → %.17g
    const samples = fc.sample(
      fc.oneof(
        // Regular doubles with manageable magnitude
        fc.integer({ min: -1000000000, max: 1000000000 }).map((n) => n / 1000),
        // Larger values
        fc.integer({ min: -1000000000, max: 1000000000 }).map((n) => n * 1000),
        // Small fractions
        fc.integer({ min: -1000000, max: 1000000 }).map((n) => n / 1000000),
        // Zero
        fc.constant(0),
      ),
      100
    );

    const cases: TestCase[] = samples.map((v) => ({
      dataType: 'Double',
      jsonValue: Object.is(v, -0) ? '0' : v.toString(),
    }));

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const result = results[i];
      const value = samples[i];

      expect(result.typeIndex).toBe(TYPE_MAP['Double']);

      const resultValue = result.value as number;
      if (value === 0 || Object.is(value, -0)) {
        expect(resultValue).toBe(0);
      } else {
        // Double values generated from integers are exact in IEEE 754
        // and should round-trip perfectly through string serialization
        expect(resultValue).toBe(value);
      }
    }
  });

  it('Boolean preserves type_index and boolean value', () => {
    const samples = fc.sample(fc.boolean(), 100);

    const cases: TestCase[] = samples.map((v) => ({
      dataType: 'Boolean',
      jsonValue: v ? 'true' : 'false',
    }));

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const result = results[i];
      expect(result.typeIndex).toBe(TYPE_MAP['Boolean']);
      expect(result.value).toBe(samples[i]);
    }
  });

  it('String preserves type_index and string value', () => {
    // Generate printable ASCII strings (avoid control chars that complicate JSON/shell passing)
    const safeStringArb = fc.stringOf(
      fc.integer({ min: 32, max: 126 })
        .filter((c) => c !== 0)
        .map((c) => String.fromCharCode(c)),
      { minLength: 1, maxLength: 100 }
    );

    const samples = fc.sample(safeStringArb, 100);

    const cases: TestCase[] = samples.map((v) => ({
      dataType: 'String',
      jsonValue: JSON.stringify(v),
    }));

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const result = results[i];
      expect(result.typeIndex).toBe(TYPE_MAP['String']);
      expect(result.value).toBe(samples[i]);
    }
  });

  it('null value produces zero/empty default with correct type_index', () => {
    const typeNames = Object.keys(TYPE_MAP);
    const samples = fc.sample(fc.constantFrom(...typeNames), 100);

    const cases: TestCase[] = samples.map((typeName) => ({
      dataType: typeName,
      jsonValue: 'null',
    }));

    const results = invokeBatch(cases);

    for (let i = 0; i < cases.length; i++) {
      const typeName = samples[i];
      const result = results[i];

      expect(result.typeIndex).toBe(TYPE_MAP[typeName]);

      if (typeName === 'Boolean') {
        expect(result.value).toBe(false);
      } else if (typeName === 'String') {
        expect(result.value).toBe('');
      } else {
        expect(result.value).toBe(0);
      }
    }
  });
});

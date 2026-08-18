import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadPlugins, validateConnectorModule } from '../../src/connectors/core/plugin-loader.js';

/**
 * Feature: connector-plugin-architecture
 * Property 1: Plugin discovery correctly classifies directories
 * Property 4: Built-in plugins take precedence over external
 *
 * Validates: Requirements 1.1, 1.2, 7.1, 7.2, 8.3
 */

// Track temp directories for cleanup
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

/**
 * Generate a valid connector type identifier.
 * Alphanumeric with hyphens, similar to real protocol identifiers.
 */
const arbConnectorType = fc
  .string({ minLength: 2, maxLength: 12 })
  .map((s) => s.replace(/[^a-z0-9]/gi, 'x').toLowerCase())
  .filter((s) => s.length >= 2);

/**
 * Create a minimal ESM index.js file that exports a valid ConnectorPlugin class.
 */
function createPluginIndexContent(type: string, displayName: string): string {
  return `
export class TestConnector {
  getType() { return '${type}'; }

  getMetadata() {
    return {
      type: '${type}',
      displayName: '${displayName}',
      description: 'Test connector for ${type}',
      paramsSchema: [
        { key: 'host', label: 'Host', type: 'text', required: true }
      ]
    };
  }

  start() {}
  stop() {}
  addConnection() {}
  removeConnection() {}
  updateConnection() {}
  addMapping() {}
  removeMapping() {}
  getStatus() { return []; }
  getCurrentValues() { return []; }
  onValueUpdate() {}
}
`;
}

describe('Feature: connector-plugin-architecture, Property 4: Built-in plugins take precedence over external', () => {
  /**
   * Validates: Requirements 8.3
   *
   * For any type collision between a built-in plugin and an external plugin,
   * the built-in connector SHALL be the one registered, regardless of
   * directory ordering within the external directory.
   */
  it('built-in plugins always take precedence over external plugins with same type', async () => {
    await fc.assert(
      fc.asyncProperty(arbConnectorType, async (connectorType) => {
        // Create temp directories for built-in and external plugins
        const builtInBase = await mkdtemp(join(tmpdir(), 'pbt-builtin-'));
        const externalBase = await mkdtemp(join(tmpdir(), 'pbt-external-'));
        tempDirs.push(builtInBase, externalBase);

        const builtInPluginDir = join(builtInBase, connectorType);
        const externalPluginDir = join(externalBase, connectorType);

        await mkdir(builtInPluginDir, { recursive: true });
        await mkdir(externalPluginDir, { recursive: true });

        // Write built-in plugin with distinct displayName
        const builtInContent = createPluginIndexContent(
          connectorType,
          `Built-in ${connectorType}`
        );
        await writeFile(join(builtInPluginDir, 'index.js'), builtInContent, 'utf-8');

        // Write external plugin with same type but different displayName
        const externalContent = createPluginIndexContent(
          connectorType,
          `External ${connectorType}`
        );
        await writeFile(join(externalPluginDir, 'index.js'), externalContent, 'utf-8');

        // Load plugins with both directories
        const result = await loadPlugins(builtInBase, externalBase);

        // Assert: the built-in plugin is the one registered
        const loadedPlugin = result.loaded.find((p) => p.type === connectorType);
        expect(loadedPlugin).toBeDefined();
        expect(loadedPlugin!.source).toBe('built-in');
        expect(loadedPlugin!.displayName).toBe(`Built-in ${connectorType}`);

        // Assert: the external one is skipped with reason about already registered
        const skippedExternal = result.skipped.find(
          (s) => s.directory === connectorType && s.reason.includes('already registered')
        );
        expect(skippedExternal).toBeDefined();
      }),
      { numRuns: 20 } // Lower count due to filesystem I/O overhead
    );
  });
});


// --- Property 1: Plugin discovery correctly classifies directories ---

/**
 * Create a constructible class (via function constructor) that has getType() and getMetadata().
 * Simulates a valid connector module export.
 */
function makeValidConnectorClass(type: string, metadata: object): new () => unknown {
  function ConnectorClass(this: Record<string, unknown>): void {
    this.type = type;
    this.metadata = metadata;
  }
  ConnectorClass.prototype.getType = function (): string { return type; };
  ConnectorClass.prototype.getMetadata = function (): object { return metadata; };
  // Add other Connector interface methods to pass duck-typing
  ConnectorClass.prototype.start = function (): void {};
  ConnectorClass.prototype.stop = function (): void {};
  ConnectorClass.prototype.addConnection = function (): void {};
  ConnectorClass.prototype.removeConnection = function (): void {};
  ConnectorClass.prototype.updateConnection = function (): void {};
  ConnectorClass.prototype.addMapping = function (): void {};
  ConnectorClass.prototype.removeMapping = function (): void {};
  ConnectorClass.prototype.getStatus = function (): unknown[] { return []; };
  ConnectorClass.prototype.getCurrentValues = function (): unknown[] { return []; };
  ConnectorClass.prototype.onValueUpdate = function (): void {};
  return ConnectorClass as unknown as new () => unknown;
}

/** Generate a valid connector type string (alphanumeric with hyphens). */
const arbValidType = fc
  .string({ minLength: 1, maxLength: 15 })
  .map((s) => s.replace(/[^a-z0-9-]/gi, 'x').toLowerCase())
  .filter((s) => s.length >= 1);

/** Generate a valid metadata-like object. */
const arbValidMetadata = fc.record({
  type: arbValidType,
  displayName: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  paramsSchema: fc.array(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 10 }).map((s) => s.replace(/[^a-zA-Z]/g, 'k')).filter((s) => s.length >= 1),
      label: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      type: fc.constantFrom('text', 'number', 'boolean', 'select'),
      required: fc.boolean(),
    }),
    { minLength: 0, maxLength: 3 }
  ),
});

/**
 * Generate a valid module (Record<string, unknown>) that has at least one
 * constructible export with getType() and getMetadata() methods.
 */
const arbValidModule: fc.Arbitrary<Record<string, unknown>> = fc.tuple(
  arbValidType,
  arbValidMetadata,
  fc.constantFrom('default', 'MyConnector', 'PluginConnector', 'TestConnector'),
  fc.boolean(),
).map(([type, metadata, exportName, addExtra]) => {
  const mod: Record<string, unknown> = {};
  mod[exportName] = makeValidConnectorClass(type, metadata);
  if (addExtra) {
    mod['VERSION'] = '1.0.0';
    mod['helperFn'] = (): string => 'utility';
  }
  return mod;
});

/**
 * Generate an invalid module — one that does NOT have a valid connector export.
 * Strategies: empty module, primitive-only exports, non-constructible functions,
 * classes missing getType, null exports.
 */
const arbInvalidModule: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // Empty module
  fc.constant({}),

  // Module with only primitive values (no functions at all)
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 10 }),
    version: fc.integer({ min: 1, max: 100 }),
  }).map((obj) => obj as Record<string, unknown>),

  // Module with null/undefined default export
  fc.constant({ default: null, other: undefined } as Record<string, unknown>),

  // Module with a class missing getType (has only getMetadata)
  fc.constant({
    default: class {
      getMetadata(): object {
        return { type: 'test', displayName: 'Test', paramsSchema: [] };
      }
    },
  } as Record<string, unknown>),

  // Module with only non-function values (arrays, objects)
  fc.constant({
    config: { host: 'localhost' },
    items: [1, 2, 3],
    flag: true,
  } as Record<string, unknown>),
);

describe('Feature: connector-plugin-architecture, Property 1: Plugin discovery correctly classifies directories', () => {
  /**
   * Validates: Requirements 1.1, 1.2
   *
   * For any module with a valid connector export (constructible class with
   * getType() returning a string and getMetadata() returning an object),
   * validateConnectorModule SHALL return { valid: true, ConnectorClass }.
   */
  it('should classify valid connector modules as valid', () => {
    fc.assert(
      fc.property(arbValidModule, (mod) => {
        const result = validateConnectorModule(mod);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.ConnectorClass).toBeDefined();
          expect(typeof result.ConnectorClass).toBe('function');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 7.1, 7.2
   *
   * For any module without a valid connector export, validateConnectorModule
   * SHALL return { valid: false, reason: string } with a non-empty reason.
   */
  it('should classify invalid modules as invalid with a reason', () => {
    fc.assert(
      fc.property(arbInvalidModule, (mod) => {
        const result = validateConnectorModule(mod);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(typeof result.reason).toBe('string');
          expect(result.reason.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 7.1, 7.2
   *
   * For ANY module object (valid, invalid, or adversarial),
   * validateConnectorModule SHALL never throw — it always returns a result.
   */
  it('should never throw regardless of module contents', () => {
    const arbAnyModule: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
      arbValidModule,
      arbInvalidModule,
      // Adversarial inputs: random objects with various value types
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(() => { throw new Error('trap'); }),
          // A class whose constructor throws
          fc.constant(class { constructor() { throw new Error('cannot instantiate'); } }),
        )
      ),
    );

    fc.assert(
      fc.property(arbAnyModule, (mod) => {
        // Should never throw
        const result = validateConnectorModule(mod);

        // Must always return a valid result shape
        expect(result).toBeDefined();
        expect(typeof result.valid).toBe('boolean');

        if (result.valid) {
          expect(result).toHaveProperty('ConnectorClass');
        } else {
          expect(typeof result.reason).toBe('string');
          expect(result.reason.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 }
    );
  });
});

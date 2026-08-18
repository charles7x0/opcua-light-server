import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { loadPlugins } from '../../src/connectors/core/plugin-loader.js';

/**
 * Integration test for full plugin discovery at startup.
 *
 * Validates: Requirements 1.1, 6.1, 10.1
 *
 * Uses the actual compiled connectors in `dist/connectors/` to verify
 * that `loadPlugins()` discovers and loads all 4 built-in connectors
 * with correct metadata.
 *
 * Prerequisite: The project must be built (`npm run build`) before running
 * this test, since the plugin loader uses dynamic `import()` on `.js` files.
 */

const CONNECTORS_DIR = join(__dirname, '../../dist/connectors/protocols');

describe('Plugin Discovery Integration', () => {
  it('discovers all 4 built-in connectors', async () => {
    const result = await loadPlugins(CONNECTORS_DIR);

    expect(result.loaded.length).toBe(4);
    expect(result.skipped.length).toBe(0);

    const types = result.loaded.map((p) => p.type).sort();
    expect(types).toEqual(['ethernet-ip', 'modbus-tcp', 'pccc', 's7']);
  });

  it('each loaded plugin has correct metadata structure', async () => {
    const result = await loadPlugins(CONNECTORS_DIR);

    for (const plugin of result.loaded) {
      // Each plugin must have a non-empty displayName
      expect(plugin.displayName).toBeTruthy();
      expect(typeof plugin.displayName).toBe('string');

      // Each plugin must have a non-empty paramsSchema
      expect(plugin.metadata.paramsSchema.length).toBeGreaterThan(0);

      // Each plugin must be marked as built-in
      expect(plugin.source).toBe('built-in');

      // Metadata type must match plugin type
      expect(plugin.metadata.type).toBe(plugin.type);
      expect(plugin.metadata.displayName).toBe(plugin.displayName);
    }
  });

  it('S7 connector has expected metadata', async () => {
    const result = await loadPlugins(CONNECTORS_DIR);
    const s7 = result.loaded.find((p) => p.type === 's7');

    expect(s7).toBeDefined();
    expect(s7!.displayName).toBe('Siemens S7');
    expect(s7!.metadata.paramsSchema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'host', type: 'text', required: true }),
        expect.objectContaining({ key: 'rack', type: 'number' }),
        expect.objectContaining({ key: 'slot', type: 'number' }),
      ])
    );
  });

  it('Modbus TCP connector has expected metadata', async () => {
    const result = await loadPlugins(CONNECTORS_DIR);
    const modbus = result.loaded.find((p) => p.type === 'modbus-tcp');

    expect(modbus).toBeDefined();
    expect(modbus!.displayName).toBe('Modbus TCP');
    expect(modbus!.metadata.paramsSchema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'host', type: 'text', required: true }),
        expect.objectContaining({ key: 'port', type: 'number' }),
      ])
    );
  });

  it('EtherNet/IP connector has expected metadata', async () => {
    const result = await loadPlugins(CONNECTORS_DIR);
    const eip = result.loaded.find((p) => p.type === 'ethernet-ip');

    expect(eip).toBeDefined();
    expect(eip!.displayName).toBe('EtherNet/IP');
    expect(eip!.metadata.paramsSchema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'host', type: 'text', required: true }),
      ])
    );
  });

  it('PCCC connector has expected metadata', async () => {
    const result = await loadPlugins(CONNECTORS_DIR);
    const pccc = result.loaded.find((p) => p.type === 'pccc');

    expect(pccc).toBeDefined();
    expect(pccc!.displayName).toBe('PCCC');
    expect(pccc!.metadata.paramsSchema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'host', type: 'text', required: true }),
      ])
    );
  });

  it('GET /api/connectors/protocols returns 4 protocols with correct metadata', async () => {
    // Simulate what the protocols endpoint does: load plugins and collect metadata
    const result = await loadPlugins(CONNECTORS_DIR);

    // The API endpoint returns the metadata array from all loaded plugins
    const protocols = result.loaded.map((p) => p.metadata);

    expect(protocols).toHaveLength(4);

    for (const protocol of protocols) {
      // Each protocol response must include required fields
      expect(protocol.type).toBeTruthy();
      expect(protocol.displayName).toBeTruthy();
      expect(protocol.paramsSchema).toBeInstanceOf(Array);
      expect(protocol.paramsSchema.length).toBeGreaterThan(0);

      // Each param field in the schema must have required properties
      for (const field of protocol.paramsSchema) {
        expect(field.key).toBeTruthy();
        expect(field.label).toBeTruthy();
        expect(['text', 'number', 'boolean', 'select']).toContain(field.type);
        expect(typeof field.required).toBe('boolean');
      }
    }

    // Verify all 4 expected types are present
    const types = protocols.map((p) => p.type).sort();
    expect(types).toEqual(['ethernet-ip', 'modbus-tcp', 'pccc', 's7']);
  });
});

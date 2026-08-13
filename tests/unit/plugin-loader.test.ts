import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadPlugins, validateConnectorModule } from '../../src/connectors/plugin-loader.js';

/**
 * Helper: Creates a temp directory for test fixtures.
 */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'plugin-loader-test-'));
}

/**
 * Helper: Creates a plugin subdirectory with an index.js file.
 */
async function createPlugin(baseDir: string, name: string, content: string): Promise<string> {
  const pluginDir = join(baseDir, name);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, 'index.js'), content, 'utf-8');
  return pluginDir;
}

/** Valid connector module content (ESM). */
const VALID_CONNECTOR_JS = `
export class TestConnector {
  getType() { return 'test'; }
  getMetadata() {
    return {
      type: 'test',
      displayName: 'Test Connector',
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

// Track temp dirs for cleanup
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe('plugin-loader', () => {
  describe('loadPlugins - valid connector module', () => {
    it('should load a valid connector plugin from a directory', async () => {
      const baseDir = await createTempDir();
      tempDirs.push(baseDir);

      await createPlugin(baseDir, 'test-connector', VALID_CONNECTOR_JS);

      const result = await loadPlugins(baseDir);

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].type).toBe('test');
      expect(result.loaded[0].displayName).toBe('Test Connector');
      expect(result.loaded[0].source).toBe('built-in');
      expect(result.loaded[0].connector).toBeDefined();
      expect(result.loaded[0].metadata.paramsSchema).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe('loadPlugins - missing index.js', () => {
    it('should skip a directory without index.js and report reason', async () => {
      const baseDir = await createTempDir();
      tempDirs.push(baseDir);

      // Create an empty subdirectory (no index.js)
      await mkdir(join(baseDir, 'empty-plugin'), { recursive: true });

      const result = await loadPlugins(baseDir);

      expect(result.loaded).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].directory).toBe('empty-plugin');
      expect(result.skipped[0].reason).toContain('no entry point found');
    });
  });

  describe('loadPlugins - module that throws on import', () => {
    it('should skip a module that throws during import', async () => {
      const baseDir = await createTempDir();
      tempDirs.push(baseDir);

      const throwingModule = `throw new Error('intentional failure');`;
      await createPlugin(baseDir, 'broken-plugin', throwingModule);

      const result = await loadPlugins(baseDir);

      expect(result.loaded).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].directory).toBe('broken-plugin');
      expect(result.skipped[0].reason).toContain('failed to import');
    });
  });

  describe('loadPlugins - non-Connector export', () => {
    it('should skip a module exporting a class without getType()', async () => {
      const baseDir = await createTempDir();
      tempDirs.push(baseDir);

      const nonConnectorModule = `
export class NotAConnector {
  doSomething() { return 'hello'; }
}
`;
      await createPlugin(baseDir, 'invalid-plugin', nonConnectorModule);

      const result = await loadPlugins(baseDir);

      expect(result.loaded).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].directory).toBe('invalid-plugin');
      expect(result.skipped[0].reason).toContain('no valid Connector export found');
    });
  });

  describe('loadPlugins - missing getMetadata()', () => {
    it('should skip a module with getType() but no getMetadata()', async () => {
      const baseDir = await createTempDir();
      tempDirs.push(baseDir);

      const noMetadataModule = `
export class IncompleteConnector {
  getType() { return 'incomplete'; }
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
      await createPlugin(baseDir, 'no-metadata-plugin', noMetadataModule);

      const result = await loadPlugins(baseDir);

      expect(result.loaded).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].directory).toBe('no-metadata-plugin');
      expect(result.skipped[0].reason).toContain('missing getMetadata method');
    });
  });

  describe('loadPlugins - duplicate type registration', () => {
    it('should load the first plugin and skip the second with same type', async () => {
      const baseDir = await createTempDir();
      tempDirs.push(baseDir);

      const connectorA = `
export class ConnectorA {
  getType() { return 'duplicate-type'; }
  getMetadata() {
    return { type: 'duplicate-type', displayName: 'First', paramsSchema: [] };
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
      const connectorB = `
export class ConnectorB {
  getType() { return 'duplicate-type'; }
  getMetadata() {
    return { type: 'duplicate-type', displayName: 'Second', paramsSchema: [] };
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
      // Create two plugins with same type (alphabetical order ensures 'aaa' comes first)
      await createPlugin(baseDir, 'aaa-first', connectorA);
      await createPlugin(baseDir, 'bbb-second', connectorB);

      const result = await loadPlugins(baseDir);

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].displayName).toBe('First');
      expect(result.loaded[0].type).toBe('duplicate-type');

      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('already registered');
    });
  });

  describe('loadPlugins - external directory scanning', () => {
    it('should load external plugins with source "external"', async () => {
      const builtInDir = await createTempDir();
      const externalDir = await createTempDir();
      tempDirs.push(builtInDir, externalDir);

      // Built-in plugin
      const builtInModule = `
export class BuiltInConnector {
  getType() { return 'built-in-type'; }
  getMetadata() {
    return { type: 'built-in-type', displayName: 'Built-In', paramsSchema: [] };
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
      // External plugin (different type)
      const externalModule = `
export class ExternalConnector {
  getType() { return 'external-type'; }
  getMetadata() {
    return { type: 'external-type', displayName: 'External', paramsSchema: [] };
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
      await createPlugin(builtInDir, 'built-in-connector', builtInModule);
      await createPlugin(externalDir, 'external-connector', externalModule);

      const result = await loadPlugins(builtInDir, externalDir);

      expect(result.loaded).toHaveLength(2);

      const builtIn = result.loaded.find((p) => p.type === 'built-in-type');
      const external = result.loaded.find((p) => p.type === 'external-type');

      expect(builtIn).toBeDefined();
      expect(builtIn!.source).toBe('built-in');

      expect(external).toBeDefined();
      expect(external!.source).toBe('external');
    });

    it('should give precedence to built-in over external on type collision', async () => {
      const builtInDir = await createTempDir();
      const externalDir = await createTempDir();
      tempDirs.push(builtInDir, externalDir);

      const builtInModule = `
export class BuiltInConnector {
  getType() { return 'collision-type'; }
  getMetadata() {
    return { type: 'collision-type', displayName: 'Built-In Wins', paramsSchema: [] };
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
      const externalModule = `
export class ExternalConnector {
  getType() { return 'collision-type'; }
  getMetadata() {
    return { type: 'collision-type', displayName: 'External Loses', paramsSchema: [] };
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
      await createPlugin(builtInDir, 'builtin-conn', builtInModule);
      await createPlugin(externalDir, 'external-conn', externalModule);

      const result = await loadPlugins(builtInDir, externalDir);

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].displayName).toBe('Built-In Wins');
      expect(result.loaded[0].source).toBe('built-in');

      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('already registered');
    });
  });

  describe('loadPlugins - missing external directory', () => {
    it('should not crash when externalDir does not exist', async () => {
      const builtInDir = await createTempDir();
      tempDirs.push(builtInDir);

      await createPlugin(builtInDir, 'valid-connector', VALID_CONNECTOR_JS);

      const nonExistentPath = join(tmpdir(), 'non-existent-plugin-dir-' + Date.now());

      const result = await loadPlugins(builtInDir, nonExistentPath);

      // Built-in still loads fine
      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].type).toBe('test');
    });
  });

  describe('validateConnectorModule', () => {
    it('should return valid for a module with proper Connector class', () => {
      class GoodConnector {
        getType() { return 'good'; }
        getMetadata() { return { type: 'good', displayName: 'Good', paramsSchema: [] }; }
        start() {}
        stop() {}
      }

      const result = validateConnectorModule({ GoodConnector });
      expect(result.valid).toBe(true);
    });

    it('should return invalid for empty module', () => {
      const result = validateConnectorModule({});
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty('reason', 'no valid Connector export found');
    });

    it('should return invalid for module with class missing getType', () => {
      class BadConnector {
        doWork() { return 42; }
      }

      const result = validateConnectorModule({ BadConnector });
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty('reason', 'no valid Connector export found');
    });

    it('should return invalid for module with getType but no getMetadata', () => {
      class PartialConnector {
        getType() { return 'partial'; }
        start() {}
        stop() {}
      }

      const result = validateConnectorModule({ PartialConnector });
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty('reason', 'missing getMetadata method');
    });
  });
});

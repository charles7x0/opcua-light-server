import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { randomUUID } from 'crypto';
import { ProcessManager } from '../../src/process-manager/index.js';
import { ConfigGenerator } from '../../src/config-generator/index.js';
import { Database } from '../../src/db/database.js';

/**
 * Integration tests for the OPC UA runtime lifecycle.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 5.1, 5.2
 *
 * Uses a Node.js mock script as a stand-in for the open62541 binary.
 * The actual runtime tests are skipped if the binary is not available.
 */

const ACTUAL_RUNTIME_PATH = join(process.cwd(), 'runtime', 'opcua-runtime');
const isWindows = platform() === 'win32';

let testDir: string;
let configFilePath: string;

/**
 * Create a self-contained Node.js mock script that mimics the runtime.
 * The script path is passed as argv[2] by ProcessManager (the "config" arg).
 * Since we use node.exe as the executable, argv[2] is actually the script itself.
 * The real config path is embedded in the script at creation time.
 */
function createMockRuntimeScript(embeddedConfigPath: string): string {
  const scriptPath = join(testDir, `mock-runtime-${randomUUID().slice(0, 8)}.js`);
  const script = `
'use strict';
const fs = require('fs');
const configPath = ${JSON.stringify(embeddedConfigPath)};

// Read config if available
if (configPath && fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    process.stdout.write('Runtime started, config v' + config.version + '\\n');
  } catch (e) {
    process.stdout.write('Runtime started\\n');
  }
} else {
  process.stdout.write('Runtime started\\n');
}
process.stdout.write('clients:0\\n');

const interval = setInterval(() => {}, 500);

process.on('SIGTERM', () => {
  clearInterval(interval);
  process.exit(0);
});
process.on('SIGINT', () => {
  clearInterval(interval);
  process.exit(0);
});
if (process.platform !== 'win32') {
  process.on('SIGUSR1', () => {
    process.stdout.write('Config reloaded\\n');
  });
}
`;
  writeFileSync(scriptPath, script, 'utf-8');
  return scriptPath;
}

/**
 * Create a script that crashes immediately after a short delay.
 */
function createCrashScript(): string {
  const scriptPath = join(testDir, `crash-runtime-${randomUUID().slice(0, 8)}.js`);
  const script = `
'use strict';
process.stderr.write('Segmentation fault (simulated)\\n');
setTimeout(() => process.exit(139), 100);
`;
  writeFileSync(scriptPath, script, 'utf-8');
  return scriptPath;
}

/**
 * Create a ProcessManager using node.exe as the executable.
 * The "configFilePath" parameter is actually the script path that node will run.
 */
function createPM(scriptPath: string): ProcessManager {
  return new ProcessManager(process.execPath, scriptPath);
}

describe('Runtime Lifecycle Integration Tests', () => {
  let db: Database;

  beforeAll(() => {
    testDir = join(tmpdir(), `opcua-integ-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    configFilePath = join(testDir, 'test-config.json');
  });

  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  function seedTestData(): void {
    const conn = db.getConnection();
    const nsId = randomUUID();
    const nodeId = randomUUID();
    conn.prepare(
      `INSERT INTO namespaces (id, name, description, uri) VALUES (?, ?, ?, ?)`
    ).run(nsId, 'TestNamespace', 'Integration test', 'urn:opcua-light:test');
    conn.prepare(
      `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value)
       VALUES (?, ?, NULL, ?, ?, ?)`
    ).run(nodeId, nsId, 'Temperature', 'Double', JSON.stringify(25.0));
  }

  function generateConfig(): void {
    const configGen = new ConfigGenerator(db);
    configGen.writeToFile(configFilePath);
  }

  describe('Config Generation → Runtime Load (Req 5.1, 5.2)', () => {
    it('should generate a valid JSON config from database state', () => {
      seedTestData();
      generateConfig();

      expect(existsSync(configFilePath)).toBe(true);
      const config = JSON.parse(readFileSync(configFilePath, 'utf-8'));

      expect(config.version).toBe(1);
      expect(config.generatedAt).toBeDefined();
      expect(config.security).toBeDefined();
      expect(config.namespaces).toHaveLength(1);
      expect(config.namespaces[0].name).toBe('TestNamespace');
      expect(config.namespaces[0].nodes).toHaveLength(1);
      expect(config.namespaces[0].nodes[0].name).toBe('Temperature');
      expect(config.namespaces[0].nodes[0].dataType).toBe('Double');
    });

    it('should include security config in generated output', () => {
      seedTestData();
      const conn = db.getConnection();
      conn.prepare(
        `UPDATE security_config SET mode = ?, certificate_path = ? WHERE id = 1`
      ).run('Sign', '/certs/server.der');

      generateConfig();
      const config = JSON.parse(readFileSync(configFilePath, 'utf-8'));

      expect(config.security.mode).toBe('Sign');
      expect(config.security.certificatePath).toBe('/certs/server.der');
    });

    it('should generate config with multiple namespaces', () => {
      const conn = db.getConnection();
      const ns1Id = randomUUID();
      const ns2Id = randomUUID();

      conn.prepare(
        `INSERT INTO namespaces (id, name, description, uri) VALUES (?, ?, ?, ?)`
      ).run(ns1Id, 'Devices', 'Devices ns', 'urn:opcua-light:devices');
      conn.prepare(
        `INSERT INTO namespaces (id, name, description, uri) VALUES (?, ?, ?, ?)`
      ).run(ns2Id, 'Sensors', 'Sensors ns', 'urn:opcua-light:sensors');
      conn.prepare(
        `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value)
         VALUES (?, ?, NULL, ?, ?, ?)`
      ).run(randomUUID(), ns1Id, 'Motor1Speed', 'Float', JSON.stringify(0.0));
      conn.prepare(
        `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value)
         VALUES (?, ?, NULL, ?, ?, ?)`
      ).run(randomUUID(), ns2Id, 'TempSensor1', 'Double', JSON.stringify(22.5));

      generateConfig();
      const config = JSON.parse(readFileSync(configFilePath, 'utf-8'));

      expect(config.namespaces).toHaveLength(2);
      const devNs = config.namespaces.find((ns: any) => ns.name === 'Devices');
      const senNs = config.namespaces.find((ns: any) => ns.name === 'Sensors');
      expect(devNs.nodes[0].name).toBe('Motor1Speed');
      expect(senNs.nodes[0].name).toBe('TempSensor1');
    });
  });

  describe('Full Lifecycle (Req 4.1, 4.2, 4.3)', () => {
    it('should start the process and report running status', async () => {
      seedTestData();
      generateConfig();
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);

      try {
        const result = await pm.start();
        expect(result.pid).toBeGreaterThan(0);
        expect(result.startedAt).toBeInstanceOf(Date);

        const status = pm.getStatus();
        expect(status.state).toBe('running');
        expect(status.pid).toBe(result.pid);
        expect(status.uptime).toBeGreaterThanOrEqual(0);
      } finally {
        try { await pm.stop(); } catch { /* ignore */ }
      }
    });

    it('should complete full lifecycle: start → reload → stop', async () => {
      seedTestData();
      generateConfig();
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);

      // Start
      const startResult = await pm.start();
      expect(startResult.pid).toBeGreaterThan(0);
      expect(pm.getStatus().state).toBe('running');

      // Wait for stabilization
      await new Promise(r => setTimeout(r, 300));

      // Reload (sends SIGUSR1 on Linux, named pipe on Windows)
      // On Windows, the named pipe won't exist for our mock script,
      // so we expect the reload to fail. This is acceptable because
      // the actual runtime creates the pipe listener.
      if (isWindows) {
        await expect(pm.reload()).rejects.toThrow('Failed to send reload signal');
      } else {
        await pm.reload();

        // Verify still running after reload
        await new Promise(r => setTimeout(r, 300));
        const afterReload = pm.getStatus();
        expect(afterReload.state).toBe('running');
        expect(afterReload.pid).toBe(startResult.pid);
      }

      // Stop
      await pm.stop();

      // Verify stopped
      const afterStop = pm.getStatus();
      expect(afterStop.state).toBe('stopped');
      expect(afterStop.pid).toBeUndefined();
      expect(afterStop.uptime).toBeUndefined();
    });

    it('should track uptime while running', async () => {
      seedTestData();
      generateConfig();
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);

      try {
        await pm.start();
        await new Promise(r => setTimeout(r, 1100));

        const status = pm.getStatus();
        expect(status.state).toBe('running');
        expect(status.uptime).toBeGreaterThanOrEqual(1);
      } finally {
        try { await pm.stop(); } catch { /* ignore */ }
      }
    });

    it('should reject double start', async () => {
      seedTestData();
      generateConfig();
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);

      try {
        await pm.start();
        await expect(pm.start()).rejects.toThrow('Process is already running');
      } finally {
        try { await pm.stop(); } catch { /* ignore */ }
      }
    });

    it('should reject stop when not running', async () => {
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);
      await expect(pm.stop()).rejects.toThrow('Process is not running');
    });

    it('should reject reload when not running', async () => {
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);
      await expect(pm.reload()).rejects.toThrow('Process is not running');
    });

    it('should allow restart after stop', async () => {
      seedTestData();
      generateConfig();
      const script = createMockRuntimeScript(configFilePath);
      const pm = createPM(script);

      // First cycle
      await pm.start();
      await pm.stop();
      expect(pm.getStatus().state).toBe('stopped');

      // Second cycle
      const result = await pm.start();
      expect(result.pid).toBeGreaterThan(0);
      expect(pm.getStatus().state).toBe('running');

      await pm.stop();
    });
  });

  describe('Crash Detection (Req 4.6)', () => {
    it('should detect crash and set error status', async () => {
      const script = createCrashScript();
      const pm = createPM(script);

      const crashPromise = new Promise<string>(resolve => {
        pm.onCrash(reason => resolve(reason));
      });

      await pm.start();

      // The crash script exits after ~100ms
      const reason = await Promise.race([
        crashPromise,
        new Promise<string>(r => setTimeout(() => r('timeout'), 5000)),
      ]);

      expect(reason).not.toBe('timeout');
      expect(reason).toMatch(/exited with code/);

      const status = pm.getStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBeDefined();
      expect(status.lastError).toMatch(/exited with code/);
    });

    it('should invoke all registered crash handlers', async () => {
      const script = createCrashScript();
      const pm = createPM(script);

      const reasons: string[] = [];
      pm.onCrash(reason => reasons.push(reason));
      pm.onCrash(reason => reasons.push(`copy: ${reason}`));

      await pm.start();

      // Wait for crash
      await new Promise(r => setTimeout(r, 2000));

      expect(reasons.length).toBe(2);
      expect(reasons[0]).toMatch(/exited with code/);
      expect(reasons[1]).toMatch(/copy:.*exited with code/);
    });

    it('should allow new ProcessManager to start after crash', async () => {
      const crashScript = createCrashScript();
      const crashPm = createPM(crashScript);

      const crashPromise = new Promise<void>(resolve => {
        crashPm.onCrash(() => resolve());
      });

      await crashPm.start();
      await crashPromise;
      expect(crashPm.getStatus().state).toBe('error');

      // Start a healthy process with a new PM
      seedTestData();
      generateConfig();
      const goodScript = createMockRuntimeScript(configFilePath);
      const pm = createPM(goodScript);

      try {
        const result = await pm.start();
        expect(result.pid).toBeGreaterThan(0);
        expect(pm.getStatus().state).toBe('running');
      } finally {
        try { await pm.stop(); } catch { /* ignore */ }
      }
    });
  });

  describe('With Actual Runtime Binary', () => {
    const hasRuntime = existsSync(ACTUAL_RUNTIME_PATH);

    describe.skipIf(!hasRuntime)('actual open62541 runtime', () => {
      it('should start with generated config', async () => {
        seedTestData();
        generateConfig();
        const pm = new ProcessManager(ACTUAL_RUNTIME_PATH, configFilePath);

        try {
          const result = await pm.start();
          expect(result.pid).toBeGreaterThan(0);
          await new Promise(r => setTimeout(r, 2000));
          expect(pm.getStatus().state).toBe('running');
        } finally {
          try { await pm.stop(); } catch { /* ignore */ }
        }
      });

      it('should reload after config change', async () => {
        seedTestData();
        generateConfig();
        const pm = new ProcessManager(ACTUAL_RUNTIME_PATH, configFilePath);

        try {
          await pm.start();
          await new Promise(r => setTimeout(r, 1000));

          // Add node and regenerate
          const conn = db.getConnection();
          const nsRow = conn.prepare(
            'SELECT id FROM namespaces LIMIT 1'
          ).get() as { id: string };
          conn.prepare(
            `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value)
             VALUES (?, ?, NULL, ?, ?, ?)`
          ).run(randomUUID(), nsRow.id, 'Pressure', 'Float', JSON.stringify(101.3));

          generateConfig();
          await pm.reload();
          await new Promise(r => setTimeout(r, 1000));
          expect(pm.getStatus().state).toBe('running');
        } finally {
          try { await pm.stop(); } catch { /* ignore */ }
        }
      });

      it('should stop gracefully', async () => {
        seedTestData();
        generateConfig();
        const pm = new ProcessManager(ACTUAL_RUNTIME_PATH, configFilePath);

        await pm.start();
        await new Promise(r => setTimeout(r, 1000));
        await pm.stop();
        expect(pm.getStatus().state).toBe('stopped');
      });
    });
  });
});

/**
 * Unit tests for Connector Registry lifecycle integration with the server routes.
 * Verifies that connectors start/stop with the runtime lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createServerRouter } from '../../src/api/routes/server.js';
import type { ProcessManager } from '../../src/process-manager/index.js';
import type { ConfigGenerator } from '../../src/config-generator/index.js';
import type { ConnectorRegistry } from '../../src/connectors/core/connector-registry.js';

function createMockProcessManager(): ProcessManager {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    getStatus: vi.fn(),
    onCrash: vi.fn(),
    updateConnectedClients: vi.fn(),
    writeToStdin: vi.fn(),
  } as unknown as ProcessManager;
}

function createMockConfigGenerator(): ConfigGenerator {
  return {
    generate: vi.fn(),
    writeToFile: vi.fn(),
  } as unknown as ConfigGenerator;
}

function createMockConnectorRegistry(): ConnectorRegistry {
  return {
    startAll: vi.fn(),
    stopAll: vi.fn(),
    register: vi.fn(),
    getConnector: vi.fn(),
    getAggregatedStatus: vi.fn().mockReturnValue([]),
    getAggregatedValues: vi.fn().mockReturnValue([]),
    onValueUpdate: vi.fn(),
  } as unknown as ConnectorRegistry;
}

function createApp(pm: ProcessManager, cg: ConfigGenerator, registry?: ConnectorRegistry) {
  const app = express();
  app.use(express.json());
  const router = createServerRouter({
    processManager: pm,
    configGenerator: cg,
    connectorRegistry: registry,
    configFilePath: 'test/config.json',
  });
  app.use('/api/server', router);
  return app;
}

/**
 * Simple HTTP request helper using Node's built-in http module.
 */
async function makeRequest(
  app: express.Express,
  method: string,
  path: string
): Promise<{ status: number; body: any }> {
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to get server address'));
        return;
      }

      const options = {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({
              status: res.statusCode || 500,
              body: data ? JSON.parse(data) : null,
            });
          } catch {
            resolve({ status: res.statusCode || 500, body: data });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      req.end();
    });
  });
}

describe('Connector Registry Lifecycle Integration', () => {
  let pm: ProcessManager;
  let cg: ConfigGenerator;
  let registry: ConnectorRegistry;
  let app: express.Express;

  beforeEach(() => {
    pm = createMockProcessManager();
    cg = createMockConfigGenerator();
    registry = createMockConnectorRegistry();
    app = createApp(pm, cg, registry);
  });

  describe('POST /api/server/start', () => {
    it('should start ConnectorRegistry when runtime starts successfully', async () => {
      const startedAt = new Date('2024-01-15T10:00:00Z');
      (pm.start as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 12345,
        startedAt,
      });

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(200);
      expect(registry.startAll).toHaveBeenCalledOnce();
    });

    it('should not start ConnectorRegistry when runtime fails to start', async () => {
      (pm.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to spawn process: no PID assigned')
      );

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(500);
      expect(registry.startAll).not.toHaveBeenCalled();
    });

    it('should not start ConnectorRegistry when runtime is already running', async () => {
      (pm.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is already running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(409);
      expect(registry.startAll).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/server/stop', () => {
    it('should stop ConnectorRegistry when runtime stops successfully', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      expect(res.status).toBe(200);
      expect(registry.stopAll).toHaveBeenCalledOnce();
    });

    it('should stop ConnectorRegistry before stopping the runtime', async () => {
      const callOrder: string[] = [];
      (registry.stopAll as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('registry.stopAll');
      });
      (pm.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('pm.stop');
      });

      await makeRequest(app, 'POST', '/api/server/stop');

      expect(callOrder).toEqual(['registry.stopAll', 'pm.stop']);
    });

    it('should still stop ConnectorRegistry even when runtime stop fails', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is not running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      // Registry stop is called before pm.stop, so it should have been called
      expect(registry.stopAll).toHaveBeenCalledOnce();
      expect(res.status).toBe(409);
    });
  });

  describe('Without ConnectorRegistry', () => {
    it('should start without error when no ConnectorRegistry is provided', async () => {
      const appNoRegistry = createApp(pm, cg); // No registry
      (pm.start as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 1,
        startedAt: new Date(),
      });

      const res = await makeRequest(appNoRegistry, 'POST', '/api/server/start');

      expect(res.status).toBe(200);
    });

    it('should stop without error when no ConnectorRegistry is provided', async () => {
      const appNoRegistry = createApp(pm, cg); // No registry
      (pm.stop as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await makeRequest(appNoRegistry, 'POST', '/api/server/stop');

      expect(res.status).toBe(200);
    });
  });
});

/**
 * Unit tests for S7 Connector lifecycle integration with the server routes.
 * Verifies that S7 Connector starts/stops with the runtime lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createServerRouter } from '../../src/api/routes/server.js';
import type { ProcessManager } from '../../src/process-manager/index.js';
import type { ConfigGenerator } from '../../src/config-generator/index.js';
import type { S7Connector } from '../../src/s7-connector/index.js';

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

function createMockS7Connector(): S7Connector {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    addMapping: vi.fn(),
    removeMapping: vi.fn(),
    getStatus: vi.fn().mockReturnValue([]),
    onValueUpdate: vi.fn(),
  } as unknown as S7Connector;
}

function createApp(pm: ProcessManager, cg: ConfigGenerator, s7?: S7Connector) {
  const app = express();
  app.use(express.json());
  const router = createServerRouter({
    processManager: pm,
    configGenerator: cg,
    s7Connector: s7,
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

describe('S7 Connector Lifecycle Integration', () => {
  let pm: ProcessManager;
  let cg: ConfigGenerator;
  let s7: S7Connector;
  let app: express.Express;

  beforeEach(() => {
    pm = createMockProcessManager();
    cg = createMockConfigGenerator();
    s7 = createMockS7Connector();
    app = createApp(pm, cg, s7);
  });

  describe('POST /api/server/start', () => {
    it('should start S7 Connector when runtime starts successfully', async () => {
      const startedAt = new Date('2024-01-15T10:00:00Z');
      (pm.start as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 12345,
        startedAt,
      });

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(200);
      expect(s7.start).toHaveBeenCalledOnce();
    });

    it('should not start S7 Connector when runtime fails to start', async () => {
      (pm.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to spawn process: no PID assigned')
      );

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(500);
      expect(s7.start).not.toHaveBeenCalled();
    });

    it('should not start S7 Connector when runtime is already running', async () => {
      (pm.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is already running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(409);
      expect(s7.start).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/server/stop', () => {
    it('should stop S7 Connector when runtime stops successfully', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      expect(res.status).toBe(200);
      expect(s7.stop).toHaveBeenCalledOnce();
    });

    it('should stop S7 Connector before stopping the runtime', async () => {
      const callOrder: string[] = [];
      (s7.stop as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('s7.stop');
      });
      (pm.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('pm.stop');
      });

      await makeRequest(app, 'POST', '/api/server/stop');

      expect(callOrder).toEqual(['s7.stop', 'pm.stop']);
    });

    it('should still stop S7 Connector even when runtime stop fails', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is not running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      // S7 stop is called before pm.stop, so it should have been called
      expect(s7.stop).toHaveBeenCalledOnce();
      expect(res.status).toBe(409);
    });
  });

  describe('Without S7 Connector', () => {
    it('should start without error when no S7 Connector is provided', async () => {
      const appNoS7 = createApp(pm, cg); // No S7 connector
      (pm.start as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 1,
        startedAt: new Date(),
      });

      const res = await makeRequest(appNoS7, 'POST', '/api/server/start');

      expect(res.status).toBe(200);
    });

    it('should stop without error when no S7 Connector is provided', async () => {
      const appNoS7 = createApp(pm, cg); // No S7 connector
      (pm.stop as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await makeRequest(appNoS7, 'POST', '/api/server/stop');

      expect(res.status).toBe(200);
    });
  });
});

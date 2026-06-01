/**
 * Unit tests for the server lifecycle API routes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createServerRouter } from '../../src/api/routes/server.js';
import type { ProcessManager } from '../../src/process-manager/index.js';
import type { ConfigGenerator } from '../../src/config-generator/index.js';

/** Helper to make requests against the router. */
async function request(app: express.Express, method: string, path: string) {
  // Use a lightweight approach with supertest-like behavior via express
  return new Promise<{ status: number; body: unknown }>((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url: path,
      headers: {} as Record<string, string>,
    };

    const res = {
      statusCode: 200,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: unknown) {
        this.body = data;
        resolve({ status: this.statusCode, body: data });
      },
    };

    // Actually use the express app
    app(req as any, res as any, () => {
      resolve({ status: res.statusCode, body: res.body });
    });
  });
}

function createMockProcessManager(): ProcessManager {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    getStatus: vi.fn(),
    onCrash: vi.fn(),
    updateConnectedClients: vi.fn(),
  } as unknown as ProcessManager;
}

function createMockConfigGenerator(): ConfigGenerator {
  return {
    generate: vi.fn(),
    writeToFile: vi.fn(),
  } as unknown as ConfigGenerator;
}

function createApp(pm: ProcessManager, cg: ConfigGenerator) {
  const app = express();
  app.use(express.json());
  const router = createServerRouter({
    processManager: pm,
    configGenerator: cg,
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

describe('Server Lifecycle Routes', () => {
  let pm: ProcessManager;
  let cg: ConfigGenerator;
  let app: express.Express;

  beforeEach(() => {
    pm = createMockProcessManager();
    cg = createMockConfigGenerator();
    app = createApp(pm, cg);
  });

  describe('POST /api/server/start', () => {
    it('should generate config and start the server', async () => {
      const startedAt = new Date('2024-01-15T10:00:00Z');
      (pm.start as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 12345,
        startedAt,
      });

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        pid: 12345,
        startedAt: '2024-01-15T10:00:00.000Z',
      });
      expect(cg.writeToFile).toHaveBeenCalledWith('test/config.json');
      expect(pm.start).toHaveBeenCalled();
    });

    it('should return 409 when server is already running', async () => {
      (pm.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is already running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RUNTIME_ERROR');
      expect(res.body.error.message).toBe('Server is already running');
    });

    it('should return 500 on unexpected start failure', async () => {
      (pm.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to spawn process: no PID assigned')
      );

      const res = await makeRequest(app, 'POST', '/api/server/start');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('RUNTIME_ERROR');
      expect(res.body.error.message).toBe('Failed to spawn process: no PID assigned');
    });
  });

  describe('POST /api/server/stop', () => {
    it('should stop the server successfully', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Server stopped successfully',
      });
      expect(pm.stop).toHaveBeenCalled();
    });

    it('should return 409 when server is not running', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is not running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RUNTIME_ERROR');
      expect(res.body.error.message).toBe('Server is not running');
    });

    it('should return 500 on unexpected stop failure', async () => {
      (pm.stop as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Kill signal failed')
      );

      const res = await makeRequest(app, 'POST', '/api/server/stop');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('RUNTIME_ERROR');
      expect(res.body.error.message).toBe('Kill signal failed');
    });
  });

  describe('POST /api/server/reload', () => {
    it('should regenerate config and reload the server', async () => {
      (pm.reload as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await makeRequest(app, 'POST', '/api/server/reload');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Server configuration reloaded successfully',
      });
      expect(cg.writeToFile).toHaveBeenCalledWith('test/config.json');
      expect(pm.reload).toHaveBeenCalled();
    });

    it('should return 409 when server is not running', async () => {
      (pm.reload as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Process is not running')
      );

      const res = await makeRequest(app, 'POST', '/api/server/reload');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RUNTIME_ERROR');
      expect(res.body.error.message).toBe('Server is not running, cannot reload');
    });

    it('should return 500 on unexpected reload failure', async () => {
      (pm.reload as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to send reload signal')
      );

      const res = await makeRequest(app, 'POST', '/api/server/reload');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('RUNTIME_ERROR');
      expect(res.body.error.message).toBe('Failed to send reload signal');
    });
  });

  describe('GET /api/server/status', () => {
    it('should return running status with details', async () => {
      (pm.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: 'running',
        uptime: 3600,
        pid: 12345,
        connectedClients: 3,
      });

      const res = await makeRequest(app, 'GET', '/api/server/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        state: 'running',
        uptime: 3600,
        pid: 12345,
        connectedClients: 3,
      });
    });

    it('should return stopped status', async () => {
      (pm.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: 'stopped',
      });

      const res = await makeRequest(app, 'GET', '/api/server/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ state: 'stopped' });
    });

    it('should return error status with lastError', async () => {
      (pm.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        state: 'error',
        lastError: 'Process exited with code: 1',
      });

      const res = await makeRequest(app, 'GET', '/api/server/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        state: 'error',
        lastError: 'Process exited with code: 1',
      });
    });

    it('should return 500 if getStatus throws', async () => {
      (pm.getStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Internal failure');
      });

      const res = await makeRequest(app, 'GET', '/api/server/status');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Internal failure');
    });
  });

  describe('Config file path defaults', () => {
    it('should use default config path when not specified', async () => {
      const defaultApp = express();
      defaultApp.use(express.json());
      const router = createServerRouter({
        processManager: pm,
        configGenerator: cg,
      });
      defaultApp.use('/api/server', router);

      (pm.start as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 1,
        startedAt: new Date(),
      });

      await makeRequest(defaultApp, 'POST', '/api/server/start');

      expect(cg.writeToFile).toHaveBeenCalledWith('runtime/config.json');
    });
  });
});

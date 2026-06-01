import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { S7Repository } from '../../src/db/repositories/s7-repository.js';
import { createS7Router } from '../../src/api/routes/s7.js';

/**
 * Helper to make requests to the Express app without supertest.
 * Uses Node's built-in http module via the app.
 */
function createTestApp(repository: S7Repository): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/s7', createS7Router(repository));
  return app;
}

/** Simulates an HTTP request by calling the Express app directly. */
async function request(
  app: Express,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const req = {
      method,
      url: path,
      headers: { 'content-type': 'application/json' } as Record<string, string>,
      body: body ?? {},
    };

    let statusCode = 200;
    let responseBody: unknown = null;
    let headersSent = false;

    const res = {
      statusCode: 200,
      status(code: number) {
        statusCode = code;
        res.statusCode = code;
        return res;
      },
      json(data: unknown) {
        responseBody = data;
        headersSent = true;
        resolve({ status: statusCode, body: responseBody });
        return res;
      },
      send(data?: unknown) {
        if (!headersSent) {
          responseBody = data ?? null;
          resolve({ status: statusCode, body: responseBody });
        }
        return res;
      },
      setHeader() { return res; },
      getHeader() { return undefined; },
      end() {
        if (!headersSent) {
          resolve({ status: statusCode, body: responseBody });
        }
      },
    };

    // Use Express's internal routing
    app(req as any, res as any);
  });
}

describe('S7 API Routes', () => {
  let db: Database;
  let repo: S7Repository;
  let app: Express;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new S7Repository(db);
    app = createTestApp(repo);
  });

  afterEach(() => {
    db.close();
  });

  /** Helper to create a namespace and node for mapping tests. */
  function createTestNode(nodeId: string = 'node-1', name: string = 'Sensor1'): string {
    const conn = db.getConnection();
    const existing = conn.prepare("SELECT id FROM namespaces WHERE id = 'ns-1'").get();
    if (!existing) {
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns-1', 'TestNS', 'urn:test')"
      ).run();
    }
    conn.prepare(
      `INSERT INTO nodes (id, namespace_id, name, data_type) VALUES (?, 'ns-1', ?, 'Double')`
    ).run(nodeId, name);
    return nodeId;
  }

  describe('POST /api/s7/connections', () => {
    it('should create a connection and return 201', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        host: '192.168.1.10',
        rack: 0,
        slot: 1,
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.name).toBe('PLC1');
      expect(data.host).toBe('192.168.1.10');
      expect(data.rack).toBe(0);
      expect(data.slot).toBe(1);
      expect(data.id).toBeDefined();
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        // missing host, rack, slot
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.details).toBeDefined();
      expect(data.error.details.length).toBeGreaterThan(0);
    });

    it('should return 400 for empty name', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: '',
        host: '192.168.1.10',
        rack: 0,
        slot: 1,
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/s7/connections', () => {
    it('should return empty array when no connections exist', async () => {
      const res = await request(app, 'GET', '/api/s7/connections');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all connections', async () => {
      repo.createConnection({ name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1 });
      repo.createConnection({ name: 'PLC2', host: '10.0.0.2', rack: 0, slot: 1 });

      const res = await request(app, 'GET', '/api/s7/connections');

      expect(res.status).toBe(200);
      expect((res.body as any[]).length).toBe(2);
    });
  });

  describe('DELETE /api/s7/connections/:id', () => {
    it('should delete a connection and return 204', async () => {
      const createResult = repo.createConnection({
        name: 'PLC1',
        host: '10.0.0.1',
        rack: 0,
        slot: 1,
      });
      if (!createResult.success) return;

      const res = await request(app, 'DELETE', `/api/s7/connections/${createResult.data.id}`);

      expect(res.status).toBe(204);
      expect(repo.findConnectionById(createResult.data.id)).toBeNull();
    });

    it('should return 404 for non-existent connection', async () => {
      const res = await request(app, 'DELETE', '/api/s7/connections/non-existent');

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/s7/mappings', () => {
    it('should create a mapping and return 201', async () => {
      const nodeId = createTestNode();
      const connResult = repo.createConnection({
        name: 'PLC1',
        host: '10.0.0.1',
        rack: 0,
        slot: 1,
      });
      if (!connResult.success) return;

      const res = await request(app, 'POST', '/api/s7/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.connectionId).toBe(connResult.data.id);
      expect(data.nodeId).toBe(nodeId);
      expect(data.plcAddress).toBe('DB1,REAL0');
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app, 'POST', '/api/s7/mappings', {
        connectionId: 'some-id',
        // missing nodeId and plcAddress
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.details.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent connection', async () => {
      const nodeId = createTestNode();

      const res = await request(app, 'POST', '/api/s7/mappings', {
        connectionId: 'non-existent',
        nodeId,
        plcAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 409 for duplicate node mapping', async () => {
      const nodeId = createTestNode();
      const connResult = repo.createConnection({
        name: 'PLC1',
        host: '10.0.0.1',
        rack: 0,
        slot: 1,
      });
      if (!connResult.success) return;

      // First mapping
      await request(app, 'POST', '/api/s7/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL0',
      });

      // Duplicate
      const res = await request(app, 'POST', '/api/s7/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL4',
      });

      expect(res.status).toBe(409);
      const data = res.body as any;
      expect(data.error.code).toBe('DUPLICATE_ERROR');
    });
  });

  describe('GET /api/s7/mappings', () => {
    it('should return empty array when no mappings exist', async () => {
      const res = await request(app, 'GET', '/api/s7/mappings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all mappings', async () => {
      const nodeId = createTestNode();
      const connResult = repo.createConnection({
        name: 'PLC1',
        host: '10.0.0.1',
        rack: 0,
        slot: 1,
      });
      if (!connResult.success) return;

      repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL0',
      });

      const res = await request(app, 'GET', '/api/s7/mappings');

      expect(res.status).toBe(200);
      expect((res.body as any[]).length).toBe(1);
    });
  });

  describe('DELETE /api/s7/mappings/:id', () => {
    it('should delete a mapping and return 204', async () => {
      const nodeId = createTestNode();
      const connResult = repo.createConnection({
        name: 'PLC1',
        host: '10.0.0.1',
        rack: 0,
        slot: 1,
      });
      if (!connResult.success) return;

      const mappingResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL0',
      });
      if (!mappingResult.success) return;

      const res = await request(app, 'DELETE', `/api/s7/mappings/${mappingResult.data.id}`);

      expect(res.status).toBe(204);
      expect(repo.findMappingById(mappingResult.data.id)).toBeNull();
    });

    it('should return 404 for non-existent mapping', async () => {
      const res = await request(app, 'DELETE', '/api/s7/mappings/non-existent');

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/s7/status', () => {
    it('should return empty array when no connections exist', async () => {
      const res = await request(app, 'GET', '/api/s7/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all connections as disconnected (placeholder)', async () => {
      repo.createConnection({ name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1 });
      repo.createConnection({ name: 'PLC2', host: '10.0.0.2', rack: 0, slot: 1 });

      const res = await request(app, 'GET', '/api/s7/status');

      expect(res.status).toBe(200);
      const statuses = res.body as any[];
      expect(statuses.length).toBe(2);
      expect(statuses[0].state).toBe('disconnected');
      expect(statuses[1].state).toBe('disconnected');
      expect(statuses[0].connectionId).toBeDefined();
    });
  });
});

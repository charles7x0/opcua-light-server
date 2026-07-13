import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { ConnectorRepository } from '../../src/db/repositories/connector-repository.js';
import { createS7AliasRouter } from '../../src/api/routes/s7-alias.js';

/**
 * Helper to create the Express app with the S7 alias router mounted.
 * Uses a real in-memory Database + ConnectorRepository (no mocks).
 * No registry is passed — status/values will return fallback behavior.
 */
function createTestApp(repository: ConnectorRepository, database?: Database): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/s7', createS7AliasRouter(repository, undefined, database));
  return app;
}

/** Simulates an HTTP request by calling the Express app directly. */
async function request(
  app: Express,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const req = {
      method,
      url: path,
      headers: { 'content-type': 'application/json' } as Record<string, string>,
      body: body ?? {},
      query: {} as Record<string, string>,
      params: {} as Record<string, string>,
    };

    // Parse query params from URL
    const [urlPath, queryString] = path.split('?');
    req.url = urlPath;
    if (queryString) {
      for (const pair of queryString.split('&')) {
        const [key, value] = pair.split('=');
        req.query[key] = decodeURIComponent(value);
      }
    }

    let statusCode = 200;
    let responseBody: unknown = null;
    let headersSent = false;
    const responseHeaders: Record<string, string> = {};

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
        resolve({ status: statusCode, body: responseBody, headers: responseHeaders });
        return res;
      },
      send(data?: unknown) {
        if (!headersSent) {
          responseBody = data ?? null;
          headersSent = true;
          resolve({ status: statusCode, body: responseBody, headers: responseHeaders });
        }
        return res;
      },
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return res;
      },
      getHeader() { return undefined; },
      end() {
        if (!headersSent) {
          headersSent = true;
          resolve({ status: statusCode, body: responseBody, headers: responseHeaders });
        }
      },
    };

    // Use Express's internal routing
    app(req as any, res as any);
  });
}

describe('S7 Alias API Routes', () => {
  let db: Database;
  let repo: ConnectorRepository;
  let app: Express;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new ConnectorRepository(db);
    app = createTestApp(repo, db);
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

  /** Helper to create an S7 connection via the repository directly. */
  function createS7Connection(name: string = 'PLC1') {
    return repo.createConnection({
      type: 's7',
      name,
      params: { host: '192.168.1.10', rack: 0, slot: 1 },
    });
  }

  // ─── POST /api/s7/connections ─────────────────────────────────────────────────

  describe('POST /api/s7/connections', () => {
    it('should accept flat S7 body and return 201 with flat shape', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        host: '192.168.1.10',
        rack: 0,
        slot: 1,
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      // Flat S7 shape: host, rack, slot as top-level fields
      expect(data.name).toBe('PLC1');
      expect(data.host).toBe('192.168.1.10');
      expect(data.rack).toBe(0);
      expect(data.slot).toBe(1);
      expect(data.id).toBeDefined();
      expect(data.pollingIntervalMs).toBe(1000);
      expect(data.reconnectIntervalMs).toBe(5000);
      expect(data.enabled).toBe(true);
      // Should NOT have generalized fields
      expect(data.type).toBeUndefined();
      expect(data.params).toBeUndefined();
    });

    it('should create connection with type s7 in database', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        host: '192.168.1.10',
        rack: 0,
        slot: 1,
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      const stored = repo.findConnectionById(data.id);
      expect(stored).not.toBeNull();
      expect(stored!.type).toBe('s7');
      expect((stored!.params as any).host).toBe('192.168.1.10');
      expect((stored!.params as any).rack).toBe(0);
      expect((stored!.params as any).slot).toBe(1);
    });

    it('should accept optional pollingIntervalMs and reconnectIntervalMs', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        host: '192.168.1.10',
        rack: 0,
        slot: 1,
        pollingIntervalMs: 500,
        reconnectIntervalMs: 10000,
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.pollingIntervalMs).toBe(500);
      expect(data.reconnectIntervalMs).toBe(10000);
    });

    it('should return 400 for missing host', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        rack: 0,
        slot: 1,
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        host: '192.168.1.10',
        rack: 0,
        slot: 1,
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing rack', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        host: '192.168.1.10',
        slot: 1,
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing slot', async () => {
      const res = await request(app, 'POST', '/api/s7/connections', {
        name: 'PLC1',
        host: '192.168.1.10',
        rack: 0,
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── GET /api/s7/connections ──────────────────────────────────────────────────

  describe('GET /api/s7/connections', () => {
    it('should return empty array when no S7 connections exist', async () => {
      const res = await request(app, 'GET', '/api/s7/connections');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return only S7 connections in flat shape', async () => {
      createS7Connection('PLC1');
      createS7Connection('PLC2');
      // Create a non-S7 connection that should NOT appear
      repo.createConnection({
        type: 'modbus-tcp',
        name: 'Modbus1',
        params: { host: '192.168.1.20', port: 502, unitId: 1 },
      });

      const res = await request(app, 'GET', '/api/s7/connections');

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(2);
      // Verify flat shape
      for (const conn of data) {
        expect(conn.host).toBeDefined();
        expect(conn.rack).toBeDefined();
        expect(conn.slot).toBeDefined();
        expect(conn.type).toBeUndefined();
        expect(conn.params).toBeUndefined();
      }
    });

    it('should return connections with correct field values', async () => {
      createS7Connection('PLC1');

      const res = await request(app, 'GET', '/api/s7/connections');

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data[0].name).toBe('PLC1');
      expect(data[0].host).toBe('192.168.1.10');
      expect(data[0].rack).toBe(0);
      expect(data[0].slot).toBe(1);
      expect(data[0].pollingIntervalMs).toBe(1000);
      expect(data[0].enabled).toBe(true);
    });
  });

  // ─── PUT /api/s7/connections/:id ──────────────────────────────────────────────

  describe('PUT /api/s7/connections/:id', () => {
    it('should update an S7 connection and return flat shape', async () => {
      const result = createS7Connection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'PUT', `/api/s7/connections/${result.data.id}`, {
        name: 'PLC1-Updated',
        host: '192.168.1.99',
      });

      expect(res.status).toBe(200);
      const data = res.body as any;
      expect(data.name).toBe('PLC1-Updated');
      expect(data.host).toBe('192.168.1.99');
      expect(data.rack).toBe(0); // unchanged
      expect(data.slot).toBe(1); // unchanged
      // Flat shape
      expect(data.type).toBeUndefined();
      expect(data.params).toBeUndefined();
    });

    it('should update pollingIntervalMs', async () => {
      const result = createS7Connection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'PUT', `/api/s7/connections/${result.data.id}`, {
        pollingIntervalMs: 2000,
      });

      expect(res.status).toBe(200);
      const data = res.body as any;
      expect(data.pollingIntervalMs).toBe(2000);
    });

    it('should return 404 for non-existent connection', async () => {
      const res = await request(app, 'PUT', '/api/s7/connections/non-existent', {
        name: 'Updated',
      });

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when no fields are provided', async () => {
      const result = createS7Connection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'PUT', `/api/s7/connections/${result.data.id}`, {});

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── DELETE /api/s7/connections/:id ────────────────────────────────────────────

  describe('DELETE /api/s7/connections/:id', () => {
    it('should delete an S7 connection and return 204', async () => {
      const result = createS7Connection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'DELETE', `/api/s7/connections/${result.data.id}`);

      expect(res.status).toBe(204);
      expect(repo.findConnectionById(result.data.id)).toBeNull();
    });

    it('should return 404 for non-existent connection', async () => {
      const res = await request(app, 'DELETE', '/api/s7/connections/non-existent');

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── POST /api/s7/mappings ────────────────────────────────────────────────────

  describe('POST /api/s7/mappings', () => {
    it('should accept plcAddress and return 201 with plcAddress field', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
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
      expect(data.id).toBeDefined();
      // Should NOT have generalized field name
      expect(data.deviceAddress).toBeUndefined();
    });

    it('should store mapping with deviceAddress in database', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      const res = await request(app, 'POST', '/api/s7/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      const stored = repo.findMappingById(data.id);
      expect(stored).not.toBeNull();
      expect(stored!.deviceAddress).toBe('DB1,REAL0');
    });

    it('should return 400 for missing plcAddress', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      const res = await request(app, 'POST', '/api/s7/mappings', {
        connectionId: connResult.data.id,
        nodeId,
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
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
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      // First mapping
      await request(app, 'POST', '/api/s7/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        plcAddress: 'DB1,REAL0',
      });

      // Duplicate node
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

  // ─── GET /api/s7/mappings ─────────────────────────────────────────────────────

  describe('GET /api/s7/mappings', () => {
    it('should return empty array when no mappings exist', async () => {
      const res = await request(app, 'GET', '/api/s7/mappings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return mappings with plcAddress field (not deviceAddress)', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });

      const res = await request(app, 'GET', '/api/s7/mappings');

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(1);
      expect(data[0].plcAddress).toBe('DB1,REAL0');
      expect(data[0].deviceAddress).toBeUndefined();
      expect(data[0].connectionId).toBe(connResult.data.id);
      expect(data[0].nodeId).toBe(nodeId);
    });

    it('should filter mappings by connectionId query parameter', async () => {
      const nodeId1 = createTestNode('node-1', 'Sensor1');
      const nodeId2 = createTestNode('node-2', 'Sensor2');
      const conn1 = createS7Connection('PLC1');
      const conn2 = createS7Connection('PLC2');
      if (!conn1.success || !conn2.success) return;

      repo.createMapping({ connectionId: conn1.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' });
      repo.createMapping({ connectionId: conn2.data.id, nodeId: nodeId2, deviceAddress: 'DB2,REAL0' });

      const res = await request(app, 'GET', `/api/s7/mappings?connectionId=${conn1.data.id}`);

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(1);
      expect(data[0].connectionId).toBe(conn1.data.id);
    });
  });

  // ─── PUT /api/s7/mappings/:id ─────────────────────────────────────────────────

  describe('PUT /api/s7/mappings/:id', () => {
    it('should accept plcAddress and return plcAddress in response', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      const mapResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const res = await request(app, 'PUT', `/api/s7/mappings/${mapResult.data.id}`, {
        plcAddress: 'DB1,REAL4',
        description: 'Updated mapping',
      });

      expect(res.status).toBe(200);
      const data = res.body as any;
      expect(data.plcAddress).toBe('DB1,REAL4');
      expect(data.description).toBe('Updated mapping');
      expect(data.deviceAddress).toBeUndefined();
    });

    it('should return 404 for non-existent mapping', async () => {
      const res = await request(app, 'PUT', '/api/s7/mappings/non-existent', {
        plcAddress: 'DB1,REAL4',
      });

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when no update fields are provided', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      const mapResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const res = await request(app, 'PUT', `/api/s7/mappings/${mapResult.data.id}`, {});

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── DELETE /api/s7/mappings/:id ──────────────────────────────────────────────

  describe('DELETE /api/s7/mappings/:id', () => {
    it('should delete a mapping and return 204', async () => {
      const nodeId = createTestNode();
      const connResult = createS7Connection('PLC1');
      if (!connResult.success) return;

      const mapResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const res = await request(app, 'DELETE', `/api/s7/mappings/${mapResult.data.id}`);

      expect(res.status).toBe(204);
      expect(repo.findMappingById(mapResult.data.id)).toBeNull();
    });

    it('should return 404 for non-existent mapping', async () => {
      const res = await request(app, 'DELETE', '/api/s7/mappings/non-existent');

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── GET /api/s7/status ───────────────────────────────────────────────────────

  describe('GET /api/s7/status', () => {
    it('should return S7 connections as disconnected when no registry is provided', async () => {
      createS7Connection('PLC1');

      const res = await request(app, 'GET', '/api/s7/status');

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(1);
      expect(data[0].connectionId).toBeDefined();
      expect(data[0].state).toBe('disconnected');
    });

    it('should return empty array when no S7 connections exist', async () => {
      const res = await request(app, 'GET', '/api/s7/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── GET /api/s7/values ───────────────────────────────────────────────────────

  describe('GET /api/s7/values', () => {
    it('should return empty array when no registry is provided', async () => {
      const res = await request(app, 'GET', '/api/s7/values');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});

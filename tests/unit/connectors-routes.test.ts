import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import { Database } from '../../src/db/database.js';
import { ConnectorRepository } from '../../src/db/repositories/connector-repository.js';
import { createConnectorsRouter } from '../../src/api/routes/connectors.js';

/**
 * Helper to create the Express app with the connectors router mounted.
 * Uses a real in-memory Database + ConnectorRepository (no mocks).
 * No registry is passed — status/values will return fallback behavior.
 */
function createTestApp(repository: ConnectorRepository, database?: Database): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/connectors', createConnectorsRouter(repository, undefined, database));
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

describe('Connectors API Routes', () => {
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

  /** Helper to create a connection via the repository directly. */
  function createConnection(name: string = 'PLC1', type: string = 's7') {
    return repo.createConnection({
      type,
      name,
      params: { host: '192.168.1.10', rack: 0, slot: 1 },
    });
  }

  // ─── Connection CRUD ──────────────────────────────────────────────────────────

  describe('POST /api/connectors/connections', () => {
    it('should create a connection and return 201', async () => {
      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        name: 'PLC1',
        params: { host: '192.168.1.10', rack: 0, slot: 1 },
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.type).toBe('s7');
      expect(data.name).toBe('PLC1');
      expect(data.params.host).toBe('192.168.1.10');
      expect(data.id).toBeDefined();
      expect(data.pollingIntervalMs).toBe(1000);
      expect(data.enabled).toBe(true);
    });

    it('should return 400 for missing type', async () => {
      const res = await request(app, 'POST', '/api/connectors/connections', {
        name: 'PLC1',
        params: { host: '192.168.1.10' },
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.details).toBeDefined();
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        params: { host: '192.168.1.10' },
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing params', async () => {
      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        name: 'PLC1',
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for params as array', async () => {
      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        name: 'PLC1',
        params: [1, 2, 3],
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/connectors/connections', () => {
    it('should return empty array when no connections exist', async () => {
      const res = await request(app, 'GET', '/api/connectors/connections');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all connections', async () => {
      createConnection('PLC1', 's7');
      createConnection('Modbus1', 'modbus-tcp');

      const res = await request(app, 'GET', '/api/connectors/connections');

      expect(res.status).toBe(200);
      expect((res.body as any[]).length).toBe(2);
    });

    it('should filter connections by type query parameter', async () => {
      createConnection('PLC1', 's7');
      createConnection('PLC2', 's7');
      createConnection('Modbus1', 'modbus-tcp');

      const res = await request(app, 'GET', '/api/connectors/connections?type=s7');

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(2);
      expect(data.every((c: any) => c.type === 's7')).toBe(true);
    });

    it('should return empty array for type with no connections', async () => {
      createConnection('PLC1', 's7');

      const res = await request(app, 'GET', '/api/connectors/connections?type=modbus-tcp');

      expect(res.status).toBe(200);
      expect((res.body as any[]).length).toBe(0);
    });
  });

  describe('PUT /api/connectors/connections/:id', () => {
    it('should update a connection and return 200', async () => {
      const result = createConnection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'PUT', `/api/connectors/connections/${result.data.id}`, {
        name: 'PLC1-Updated',
        pollingIntervalMs: 2000,
      });

      expect(res.status).toBe(200);
      const data = res.body as any;
      expect(data.name).toBe('PLC1-Updated');
      expect(data.pollingIntervalMs).toBe(2000);
    });

    it('should return 404 for non-existent connection', async () => {
      const res = await request(app, 'PUT', '/api/connectors/connections/non-existent', {
        name: 'Updated',
      });

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when no fields are provided', async () => {
      const result = createConnection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'PUT', `/api/connectors/connections/${result.data.id}`, {});

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/connectors/connections/:id', () => {
    it('should delete a connection and return 204', async () => {
      const result = createConnection('PLC1');
      if (!result.success) return;

      const res = await request(app, 'DELETE', `/api/connectors/connections/${result.data.id}`);

      expect(res.status).toBe(204);
      expect(repo.findConnectionById(result.data.id)).toBeNull();
    });

    it('should return 404 for non-existent connection', async () => {
      const res = await request(app, 'DELETE', '/api/connectors/connections/non-existent');

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should cascade delete associated mappings', async () => {
      const nodeId = createTestNode();
      const result = createConnection('PLC1');
      if (!result.success) return;

      repo.createMapping({
        connectionId: result.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });

      // Verify mapping exists
      const mappingsBefore = repo.findAllMappings(result.data.id);
      expect(mappingsBefore.length).toBe(1);

      // Delete connection
      const res = await request(app, 'DELETE', `/api/connectors/connections/${result.data.id}`);
      expect(res.status).toBe(204);

      // Verify mappings are gone
      const mappingsAfter = repo.findAllMappings(result.data.id);
      expect(mappingsAfter.length).toBe(0);
    });
  });

  // ─── Mapping CRUD ─────────────────────────────────────────────────────────────

  describe('POST /api/connectors/mappings', () => {
    it('should create a mapping and return 201', async () => {
      const nodeId = createTestNode();
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const res = await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.connectionId).toBe(connResult.data.id);
      expect(data.nodeId).toBe(nodeId);
      expect(data.deviceAddress).toBe('DB1,REAL0');
      expect(data.id).toBeDefined();
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: 'some-id',
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.details.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent connection', async () => {
      const nodeId = createTestNode();

      const res = await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: 'non-existent',
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 409 for duplicate node mapping', async () => {
      const nodeId = createTestNode();
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      // First mapping
      await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });

      // Duplicate node
      const res = await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL4',
      });

      expect(res.status).toBe(409);
      const data = res.body as any;
      expect(data.error.code).toBe('DUPLICATE_ERROR');
    });

    it('should return 409 for duplicate device address on same connection', async () => {
      const nodeId1 = createTestNode('node-1', 'Sensor1');
      const nodeId2 = createTestNode('node-2', 'Sensor2');
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      // First mapping
      await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: connResult.data.id,
        nodeId: nodeId1,
        deviceAddress: 'DB1,REAL0',
      });

      // Same device address
      const res = await request(app, 'POST', '/api/connectors/mappings', {
        connectionId: connResult.data.id,
        nodeId: nodeId2,
        deviceAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(409);
      const data = res.body as any;
      expect(data.error.code).toBe('DUPLICATE_ERROR');
    });
  });

  describe('GET /api/connectors/mappings', () => {
    it('should return empty array when no mappings exist', async () => {
      const res = await request(app, 'GET', '/api/connectors/mappings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all mappings', async () => {
      const nodeId = createTestNode();
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });

      const res = await request(app, 'GET', '/api/connectors/mappings');

      expect(res.status).toBe(200);
      expect((res.body as any[]).length).toBe(1);
    });

    it('should filter mappings by connectionId query parameter', async () => {
      const nodeId1 = createTestNode('node-1', 'Sensor1');
      const nodeId2 = createTestNode('node-2', 'Sensor2');
      const conn1 = createConnection('PLC1');
      const conn2 = createConnection('PLC2');
      if (!conn1.success || !conn2.success) return;

      repo.createMapping({ connectionId: conn1.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' });
      repo.createMapping({ connectionId: conn2.data.id, nodeId: nodeId2, deviceAddress: 'DB2,REAL0' });

      const res = await request(app, 'GET', `/api/connectors/mappings?connectionId=${conn1.data.id}`);

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(1);
      expect(data[0].connectionId).toBe(conn1.data.id);
    });
  });

  describe('PUT /api/connectors/mappings/:id', () => {
    it('should update a mapping and return 200', async () => {
      const nodeId = createTestNode();
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const mapResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const res = await request(app, 'PUT', `/api/connectors/mappings/${mapResult.data.id}`, {
        deviceAddress: 'DB1,REAL4',
        description: 'Updated mapping',
      });

      expect(res.status).toBe(200);
      const data = res.body as any;
      expect(data.deviceAddress).toBe('DB1,REAL4');
      expect(data.description).toBe('Updated mapping');
    });

    it('should return 404 for non-existent mapping', async () => {
      const res = await request(app, 'PUT', '/api/connectors/mappings/non-existent', {
        deviceAddress: 'DB1,REAL4',
      });

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when no update fields are provided', async () => {
      const nodeId = createTestNode();
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const mapResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const res = await request(app, 'PUT', `/api/connectors/mappings/${mapResult.data.id}`, {});

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/connectors/mappings/:id', () => {
    it('should delete a mapping and return 204', async () => {
      const nodeId = createTestNode();
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const mapResult = repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const res = await request(app, 'DELETE', `/api/connectors/mappings/${mapResult.data.id}`);

      expect(res.status).toBe(204);
      expect(repo.findMappingById(mapResult.data.id)).toBeNull();
    });

    it('should return 404 for non-existent mapping', async () => {
      const res = await request(app, 'DELETE', '/api/connectors/mappings/non-existent');

      expect(res.status).toBe(404);
      const data = res.body as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── Bulk Mapping ─────────────────────────────────────────────────────────────

  describe('POST /api/connectors/mappings/bulk', () => {
    it('should create multiple mappings and return 201 when all succeed', async () => {
      const nodeId1 = createTestNode('node-1', 'Sensor1');
      const nodeId2 = createTestNode('node-2', 'Sensor2');
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const res = await request(app, 'POST', '/api/connectors/mappings/bulk', [
        { connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' },
        { connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL4' },
      ]);

      expect(res.status).toBe(201);
      const data = res.body as any[];
      expect(data.length).toBe(2);
      expect(data[0].success).toBe(true);
      expect(data[1].success).toBe(true);
    });

    it('should return 207 with mixed results when some fail', async () => {
      const nodeId1 = createTestNode('node-1', 'Sensor1');
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const res = await request(app, 'POST', '/api/connectors/mappings/bulk', [
        { connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' },
        { connectionId: 'non-existent', nodeId: 'node-99', deviceAddress: 'DB1,REAL4' },
      ]);

      expect(res.status).toBe(207);
      const data = res.body as any[];
      expect(data.length).toBe(2);
      expect(data[0].success).toBe(true);
      expect(data[1].success).toBe(false);
      expect(data[1].error).toBeDefined();
    });

    it('should return 400 for empty array', async () => {
      const res = await request(app, 'POST', '/api/connectors/mappings/bulk', []);

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for non-array body', async () => {
      const res = await request(app, 'POST', '/api/connectors/mappings/bulk', {
        connectionId: 'some-id',
        nodeId: 'node-1',
        deviceAddress: 'DB1,REAL0',
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── CSV Export ────────────────────────────────────────────────────────────────

  describe('GET /api/connectors/mappings/export/csv', () => {
    it('should export mappings as CSV with correct headers', async () => {
      const nodeId = createTestNode('node-1', 'Temperature');
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      repo.createMapping({
        connectionId: connResult.data.id,
        nodeId,
        deviceAddress: 'DB1,REAL0',
        description: 'Temperature sensor',
      });

      const res = await request(app, 'GET', '/api/connectors/mappings/export/csv');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('connectors-mappings.csv');

      const csv = res.body as string;
      const lines = csv.split('\n');
      expect(lines[0]).toBe('connectionName,type,deviceAddress,nodeName,namespace,description');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('PLC1');
      expect(lines[1]).toContain('s7');
      expect(lines[1]).toContain('DB1,REAL0');
      expect(lines[1]).toContain('Temperature');
      expect(lines[1]).toContain('TestNS');
    });

    it('should return empty CSV with only headers when no mappings exist', async () => {
      const res = await request(app, 'GET', '/api/connectors/mappings/export/csv');

      expect(res.status).toBe(200);
      const csv = res.body as string;
      const lines = csv.split('\n');
      expect(lines[0]).toBe('connectionName,type,deviceAddress,nodeName,namespace,description');
      expect(lines.length).toBe(1);
    });
  });

  // ─── CSV Import ────────────────────────────────────────────────────────────────

  describe('POST /api/connectors/mappings/import/csv', () => {
    it('should import mappings from CSV and return 201 when all succeed', async () => {
      const nodeId = createTestNode('node-1', 'Temperature');
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const csv = [
        'connectionName,type,deviceAddress,nodeName,namespace,description',
        'PLC1,s7,DB1.REAL0,Temperature,TestNS,Imported mapping',
      ].join('\n');

      const res = await request(app, 'POST', '/api/connectors/mappings/import/csv', { csv });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.summary.total).toBe(1);
      expect(data.summary.succeeded).toBe(1);
      expect(data.summary.failed).toBe(0);
    });

    it('should return 207 when some rows fail to import', async () => {
      const nodeId = createTestNode('node-1', 'Temperature');
      const connResult = createConnection('PLC1');
      if (!connResult.success) return;

      const csv = [
        'connectionName,type,deviceAddress,nodeName,namespace,description',
        'PLC1,s7,DB1.REAL0,Temperature,TestNS,Good row',
        'NonExistent,s7,DB2.REAL0,Temperature,TestNS,Bad connection',
      ].join('\n');

      const res = await request(app, 'POST', '/api/connectors/mappings/import/csv', { csv });

      expect(res.status).toBe(207);
      const data = res.body as any;
      expect(data.summary.total).toBe(2);
      expect(data.summary.succeeded).toBe(1);
      expect(data.summary.failed).toBe(1);
    });

    it('should return 400 when csv field is missing', async () => {
      const res = await request(app, 'POST', '/api/connectors/mappings/import/csv', {});

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when CSV has no data rows', async () => {
      const csv = 'connectionName,type,deviceAddress,nodeName,namespace,description';

      const res = await request(app, 'POST', '/api/connectors/mappings/import/csv', { csv });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Status and Values Endpoints ───────────────────────────────────────────────

  describe('GET /api/connectors/status', () => {
    it('should return all connections as disconnected when no registry is provided', async () => {
      createConnection('PLC1');
      createConnection('PLC2', 'modbus-tcp');

      const res = await request(app, 'GET', '/api/connectors/status');

      expect(res.status).toBe(200);
      const data = res.body as any[];
      expect(data.length).toBe(2);
      expect(data[0].state).toBe('disconnected');
      expect(data[1].state).toBe('disconnected');
      expect(data[0].connectionId).toBeDefined();
    });

    it('should return empty array when no connections exist', async () => {
      const res = await request(app, 'GET', '/api/connectors/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/connectors/values', () => {
    it('should return empty array when no registry is provided', async () => {
      const res = await request(app, 'GET', '/api/connectors/values');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});

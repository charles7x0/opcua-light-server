import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Database } from '../../src/db/database.js';
import { NodeRepository } from '../../src/db/repositories/node-repository.js';
import { createNodeRoutes } from '../../src/api/routes/nodes.js';

/**
 * Helper to create a test Express app with node routes.
 */
function createTestApp(repo: NodeRepository) {
  const app = express();
  app.use(express.json());
  app.use('/api/nodes', createNodeRoutes(repo));
  return app;
}

/**
 * Simple request helper that uses Node's http module to test Express routes.
 */
async function request(app: express.Application, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        resolve({ status: 500, body: {} });
        return;
      }
      const port = address.port;
      const url = `http://127.0.0.1:${port}${path}`;

      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };

      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }

      fetch(url, options)
        .then(async (res) => {
          let json: unknown = {};
          if (res.status !== 204) {
            json = await res.json().catch(() => ({}));
          }
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch(() => {
          server.close();
          resolve({ status: 500, body: {} });
        });
    });
  });
}

describe('Node API Routes', () => {
  let db: Database;
  let repo: NodeRepository;
  let app: express.Application;
  let namespaceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new NodeRepository(db);
    app = createTestApp(repo);

    // Create a namespace for nodes to belong to
    const conn = db.getConnection();
    conn.prepare(
      "INSERT INTO namespaces (id, name, uri) VALUES ('ns-1', 'TestNamespace', 'urn:test')"
    ).run();
    namespaceId = 'ns-1';
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /api/nodes', () => {
    it('should create a node with valid data', async () => {
      const res = await request(app, 'POST', '/api/nodes', {
        name: 'Temperature',
        namespaceId,
        dataType: 'Double',
        initialValue: 25.5,
        description: 'Temperature sensor',
      });

      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('Temperature');
      expect(body.namespaceId).toBe(namespaceId);
      expect(body.dataType).toBe('Double');
      expect(body.initialValue).toBe(25.5);
      expect(body.description).toBe('Temperature sensor');
      expect(body.id).toBeDefined();
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app, 'POST', '/api/nodes', {
        namespaceId,
        dataType: 'Double',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'name')).toBe(true);
    });

    it('should return 400 for missing namespaceId', async () => {
      const res = await request(app, 'POST', '/api/nodes', {
        name: 'Test',
        dataType: 'Double',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'namespaceId')).toBe(true);
    });

    it('should return 400 for unsupported data type', async () => {
      const res = await request(app, 'POST', '/api/nodes', {
        name: 'Test',
        namespaceId,
        dataType: 'Complex128',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'dataType')).toBe(true);
    });

    it('should return 409 for duplicate name within namespace', async () => {
      await request(app, 'POST', '/api/nodes', {
        name: 'Duplicate',
        namespaceId,
        dataType: 'Double',
      });

      const res = await request(app, 'POST', '/api/nodes', {
        name: 'Duplicate',
        namespaceId,
        dataType: 'Int32',
      });

      expect(res.status).toBe(409);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('DUPLICATE_ERROR');
    });
  });

  describe('GET /api/nodes', () => {
    it('should return empty array when no nodes exist', async () => {
      const res = await request(app, 'GET', '/api/nodes');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all nodes', async () => {
      await request(app, 'POST', '/api/nodes', {
        name: 'Node1',
        namespaceId,
        dataType: 'Double',
      });
      await request(app, 'POST', '/api/nodes', {
        name: 'Node2',
        namespaceId,
        dataType: 'Boolean',
      });

      const res = await request(app, 'GET', '/api/nodes');

      expect(res.status).toBe(200);
      const body = res.body as unknown[];
      expect(body).toHaveLength(2);
    });

    it('should filter nodes by namespaceId', async () => {
      // Create a second namespace
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns-2', 'OtherNamespace', 'urn:other')"
      ).run();

      await request(app, 'POST', '/api/nodes', {
        name: 'Node1',
        namespaceId: 'ns-1',
        dataType: 'Double',
      });
      await request(app, 'POST', '/api/nodes', {
        name: 'Node2',
        namespaceId: 'ns-2',
        dataType: 'Boolean',
      });

      const res = await request(app, 'GET', '/api/nodes?namespaceId=ns-1');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Node1');
    });
  });

  describe('GET /api/nodes/:id', () => {
    it('should return a node by ID', async () => {
      const createRes = await request(app, 'POST', '/api/nodes', {
        name: 'Temperature',
        namespaceId,
        dataType: 'Double',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'GET', `/api/nodes/${id}`);

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('Temperature');
      expect(body.id).toBe(id);
    });

    it('should return 404 for non-existent node', async () => {
      const res = await request(app, 'GET', '/api/nodes/non-existent-id');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/nodes/:id', () => {
    it('should update a node name', async () => {
      const createRes = await request(app, 'POST', '/api/nodes', {
        name: 'OldName',
        namespaceId,
        dataType: 'Double',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/nodes/${id}`, {
        name: 'NewName',
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('NewName');
      expect(body.dataType).toBe('Double');
    });

    it('should return 404 for non-existent node', async () => {
      const res = await request(app, 'PUT', '/api/nodes/non-existent', {
        name: 'NewName',
      });

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for empty name', async () => {
      const createRes = await request(app, 'POST', '/api/nodes', {
        name: 'Test',
        namespaceId,
        dataType: 'Double',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/nodes/${id}`, {
        name: '',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate name on update', async () => {
      await request(app, 'POST', '/api/nodes', {
        name: 'Existing',
        namespaceId,
        dataType: 'Double',
      });
      const createRes = await request(app, 'POST', '/api/nodes', {
        name: 'ToUpdate',
        namespaceId,
        dataType: 'Int32',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/nodes/${id}`, {
        name: 'Existing',
      });

      expect(res.status).toBe(409);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('DUPLICATE_ERROR');
    });
  });

  describe('DELETE /api/nodes/:id', () => {
    it('should delete an existing node', async () => {
      const createRes = await request(app, 'POST', '/api/nodes', {
        name: 'ToDelete',
        namespaceId,
        dataType: 'Double',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'DELETE', `/api/nodes/${id}`);

      expect(res.status).toBe(204);

      // Verify it's gone
      const getRes = await request(app, 'GET', `/api/nodes/${id}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent node', async () => {
      const res = await request(app, 'DELETE', '/api/nodes/non-existent');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});

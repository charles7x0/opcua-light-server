import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Database } from '../../src/db/database.js';
import { NamespaceRepository } from '../../src/db/repositories/namespace-repository.js';
import { createNamespaceRouter } from '../../src/api/routes/namespaces.js';

/**
 * Helper to make requests to the Express app without a running server.
 * Uses a lightweight approach with Express's built-in request handling.
 */
function createTestApp(repo: NamespaceRepository) {
  const app = express();
  app.use(express.json());
  app.use('/api/namespaces', createNamespaceRouter(repo));
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
          const json = await res.json().catch(() => ({}));
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

describe('Namespace API Routes', () => {
  let db: Database;
  let repo: NamespaceRepository;
  let app: express.Application;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new NamespaceRepository(db);
    app = createTestApp(repo);
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /api/namespaces', () => {
    it('should create a namespace with valid data', async () => {
      const res = await request(app, 'POST', '/api/namespaces', {
        name: 'PlantFloor',
        description: 'Main plant floor',
        uri: 'urn:opcua-light:PlantFloor',
      });

      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('PlantFloor');
      expect(body.description).toBe('Main plant floor');
      expect(body.uri).toBe('urn:opcua-light:PlantFloor');
      expect(body.id).toBeDefined();
      expect(body.nodeCount).toBe(0);
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app, 'POST', '/api/namespaces', {
        uri: 'urn:opcua-light:Test',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'name')).toBe(true);
    });

    it('should return 400 for missing uri', async () => {
      const res = await request(app, 'POST', '/api/namespaces', {
        name: 'Test',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'uri')).toBe(true);
    });

    it('should return 400 for empty name', async () => {
      const res = await request(app, 'POST', '/api/namespaces', {
        name: '   ',
        uri: 'urn:test',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate name', async () => {
      await request(app, 'POST', '/api/namespaces', {
        name: 'Duplicate',
        uri: 'urn:first',
      });

      const res = await request(app, 'POST', '/api/namespaces', {
        name: 'Duplicate',
        uri: 'urn:second',
      });

      expect(res.status).toBe(409);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('DUPLICATE_ERROR');
    });

    it('should return 409 for duplicate URI', async () => {
      await request(app, 'POST', '/api/namespaces', {
        name: 'First',
        uri: 'urn:same-uri',
      });

      const res = await request(app, 'POST', '/api/namespaces', {
        name: 'Second',
        uri: 'urn:same-uri',
      });

      expect(res.status).toBe(409);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('DUPLICATE_ERROR');
    });
  });

  describe('GET /api/namespaces', () => {
    it('should return empty array when no namespaces exist', async () => {
      const res = await request(app, 'GET', '/api/namespaces');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all namespaces with node counts', async () => {
      await request(app, 'POST', '/api/namespaces', {
        name: 'NS1',
        uri: 'urn:ns1',
      });
      await request(app, 'POST', '/api/namespaces', {
        name: 'NS2',
        uri: 'urn:ns2',
      });

      const res = await request(app, 'GET', '/api/namespaces');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      expect(body[0].nodeCount).toBe(0);
      expect(body[1].nodeCount).toBe(0);
    });
  });

  describe('PUT /api/namespaces/:id', () => {
    it('should update namespace name', async () => {
      const createRes = await request(app, 'POST', '/api/namespaces', {
        name: 'OldName',
        uri: 'urn:test',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/namespaces/${id}`, {
        name: 'NewName',
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('NewName');
      expect(body.uri).toBe('urn:test');
    });

    it('should return 404 for non-existent namespace', async () => {
      const res = await request(app, 'PUT', '/api/namespaces/non-existent', {
        name: 'NewName',
      });

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 409 for duplicate name on update', async () => {
      await request(app, 'POST', '/api/namespaces', {
        name: 'Existing',
        uri: 'urn:existing',
      });
      const createRes = await request(app, 'POST', '/api/namespaces', {
        name: 'ToUpdate',
        uri: 'urn:to-update',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/namespaces/${id}`, {
        name: 'Existing',
      });

      expect(res.status).toBe(409);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('DUPLICATE_ERROR');
    });

    it('should return 400 when no fields provided', async () => {
      const createRes = await request(app, 'POST', '/api/namespaces', {
        name: 'Test',
        uri: 'urn:test',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/namespaces/${id}`, {});

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty name string', async () => {
      const createRes = await request(app, 'POST', '/api/namespaces', {
        name: 'Test',
        uri: 'urn:test',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'PUT', `/api/namespaces/${id}`, {
        name: '',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/namespaces/:id', () => {
    it('should delete an existing namespace', async () => {
      const createRes = await request(app, 'POST', '/api/namespaces', {
        name: 'ToDelete',
        uri: 'urn:to-delete',
      });
      const id = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'DELETE', `/api/namespaces/${id}`);

      expect(res.status).toBe(200);
      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app, 'GET', '/api/namespaces');
      expect((getRes.body as unknown[]).length).toBe(0);
    });

    it('should return 404 for non-existent namespace', async () => {
      const res = await request(app, 'DELETE', '/api/namespaces/non-existent');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should cascade delete object nodes and variable nodes', async () => {
      const createRes = await request(app, 'POST', '/api/namespaces', {
        name: 'WithChildren',
        uri: 'urn:with-children',
      });
      const id = (createRes.body as Record<string, unknown>).id as string;

      // Add object nodes and variable nodes directly via DB
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f1', ?, 'Object1')"
      ).run(id);
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', ?, 'Node1', 'Double')"
      ).run(id);

      const res = await request(app, 'DELETE', `/api/namespaces/${id}`);
      expect(res.status).toBe(200);

      // Verify cascade
      const objectNodes = conn.prepare('SELECT * FROM object_nodes WHERE namespace_id = ?').all(id);
      const nodes = conn.prepare('SELECT * FROM nodes WHERE namespace_id = ?').all(id);
      expect(objectNodes).toHaveLength(0);
      expect(nodes).toHaveLength(0);
    });
  });
});

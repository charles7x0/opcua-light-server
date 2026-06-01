import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Database } from '../../src/db/database.js';
import { createObjectNodeRouter } from '../../src/api/routes/object-nodes.js';

/**
 * Helper to create a test Express app with object node routes.
 */
function createTestApp(database: Database) {
  const app = express();
  app.use(express.json());
  const objectNodeRouter = createObjectNodeRouter(database);
  app.use('/api', objectNodeRouter);
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

describe('Object Node API Routes', () => {
  let db: Database;
  let app: express.Application;
  let namespaceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    app = createTestApp(db);

    // Create a namespace for object node tests
    const conn = db.getConnection();
    conn.prepare(
      "INSERT INTO namespaces (id, name, uri) VALUES ('ns-1', 'TestNamespace', 'urn:test')"
    ).run();
    namespaceId = 'ns-1';
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /api/object-nodes', () => {
    it('should create an object node with valid data', async () => {
      const res = await request(app, 'POST', '/api/object-nodes', {
        name: 'Sensors',
        namespaceId,
      });

      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('Sensors');
      expect(body.namespaceId).toBe(namespaceId);
      expect(body.parentObjectNodeId).toBeNull();
      expect(body.id).toBeDefined();
    });

    it('should create a nested object node with parentObjectNodeId', async () => {
      const parentRes = await request(app, 'POST', '/api/object-nodes', {
        name: 'Parent',
        namespaceId,
      });
      const parentId = (parentRes.body as Record<string, unknown>).id;

      const res = await request(app, 'POST', '/api/object-nodes', {
        name: 'Child',
        namespaceId,
        parentObjectNodeId: parentId,
      });

      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(body.name).toBe('Child');
      expect(body.parentObjectNodeId).toBe(parentId);
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app, 'POST', '/api/object-nodes', {
        namespaceId,
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'name')).toBe(true);
    });

    it('should return 400 for empty name', async () => {
      const res = await request(app, 'POST', '/api/object-nodes', {
        name: '   ',
        namespaceId,
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing namespaceId', async () => {
      const res = await request(app, 'POST', '/api/object-nodes', {
        name: 'Sensors',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.some((d) => d.field === 'namespaceId')).toBe(true);
    });

    it('should return 400 for non-existent namespace', async () => {
      const res = await request(app, 'POST', '/api/object-nodes', {
        name: 'Sensors',
        namespaceId: 'non-existent-ns',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate name in same parent', async () => {
      await request(app, 'POST', '/api/object-nodes', {
        name: 'Duplicate',
        namespaceId,
      });

      const res = await request(app, 'POST', '/api/object-nodes', {
        name: 'Duplicate',
        namespaceId,
      });

      expect(res.status).toBe(409);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('DUPLICATE_ERROR');
    });

    it('should return 400 when exceeding max depth of 5', async () => {
      let parentId: string | undefined;
      for (let i = 1; i <= 5; i++) {
        const res = await request(app, 'POST', '/api/object-nodes', {
          name: `Level${i}`,
          namespaceId,
          parentObjectNodeId: parentId,
        });
        parentId = (res.body as Record<string, unknown>).id as string;
      }

      // Level 6 should fail
      const res = await request(app, 'POST', '/api/object-nodes', {
        name: 'Level6',
        namespaceId,
        parentObjectNodeId: parentId,
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('depth');
    });
  });

  describe('GET /api/namespaces/:id/object-nodes', () => {
    it('should return empty array when no object nodes exist', async () => {
      const res = await request(app, 'GET', `/api/namespaces/${namespaceId}/object-nodes`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return object node tree with nested children', async () => {
      const parentRes = await request(app, 'POST', '/api/object-nodes', {
        name: 'Parent',
        namespaceId,
      });
      const parentId = (parentRes.body as Record<string, unknown>).id;

      await request(app, 'POST', '/api/object-nodes', {
        name: 'Child',
        namespaceId,
        parentObjectNodeId: parentId,
      });

      const res = await request(app, 'GET', `/api/namespaces/${namespaceId}/object-nodes`);

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Parent');
      const children = body[0].children as Array<Record<string, unknown>>;
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe('Child');
    });

    it('should return empty array for non-existent namespace', async () => {
      const res = await request(app, 'GET', '/api/namespaces/non-existent/object-nodes');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('DELETE /api/object-nodes/:id', () => {
    it('should delete an existing object node', async () => {
      const createRes = await request(app, 'POST', '/api/object-nodes', {
        name: 'ToDelete',
        namespaceId,
      });
      const objectNodeId = (createRes.body as Record<string, unknown>).id;

      const res = await request(app, 'DELETE', `/api/object-nodes/${objectNodeId}`);

      expect(res.status).toBe(200);
      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app, 'GET', `/api/namespaces/${namespaceId}/object-nodes`);
      expect((getRes.body as unknown[]).length).toBe(0);
    });

    it('should return 404 for non-existent object node', async () => {
      const res = await request(app, 'DELETE', '/api/object-nodes/non-existent');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should reassign variable nodes to parent object node on deletion', async () => {
      const createRes = await request(app, 'POST', '/api/object-nodes', {
        name: 'ObjectWithNodes',
        namespaceId,
      });
      const objectNodeId = (createRes.body as Record<string, unknown>).id as string;

      // Add a variable node to the object node directly via DB
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', ?, ?, 'Sensor1', 'Double')"
      ).run(namespaceId, objectNodeId);

      const res = await request(app, 'DELETE', `/api/object-nodes/${objectNodeId}`);
      expect(res.status).toBe(200);

      // Verify variable node was reassigned to null (namespace root)
      const node = conn.prepare('SELECT object_node_id FROM nodes WHERE id = ?').get('n1') as { object_node_id: string | null };
      expect(node.object_node_id).toBeNull();
    });

    it('should reassign child object nodes to parent on deletion', async () => {
      const parentRes = await request(app, 'POST', '/api/object-nodes', {
        name: 'Parent',
        namespaceId,
      });
      const parentId = (parentRes.body as Record<string, unknown>).id as string;

      const childRes = await request(app, 'POST', '/api/object-nodes', {
        name: 'Child',
        namespaceId,
        parentObjectNodeId: parentId,
      });
      const childId = (childRes.body as Record<string, unknown>).id as string;

      // Delete the parent
      const res = await request(app, 'DELETE', `/api/object-nodes/${parentId}`);
      expect(res.status).toBe(200);

      // Verify child was reassigned to root (null parent)
      const conn = db.getConnection();
      const child = conn.prepare('SELECT parent_object_node_id FROM object_nodes WHERE id = ?').get(childId) as { parent_object_node_id: string | null };
      expect(child.parent_object_node_id).toBeNull();
    });
  });
});

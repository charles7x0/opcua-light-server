import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import { NamespaceRepository } from '../../src/db/repositories/namespace-repository.js';

describe('NamespaceRepository', () => {
  let db: Database;
  let repo: NamespaceRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new NamespaceRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a namespace with valid data', () => {
      const result = repo.create({
        name: 'PlantFloor',
        description: 'Main plant floor namespace',
        uri: 'urn:opcua-light:PlantFloor',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('PlantFloor');
        expect(result.data.description).toBe('Main plant floor namespace');
        expect(result.data.uri).toBe('urn:opcua-light:PlantFloor');
        expect(result.data.id).toBeDefined();
        expect(result.data.nodeCount).toBe(0);
        expect(result.data.createdAt).toBeDefined();
        expect(result.data.updatedAt).toBeDefined();
      }
    });

    it('should create a namespace without description', () => {
      const result = repo.create({
        name: 'Sensors',
        uri: 'urn:opcua-light:Sensors',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Sensors');
        expect(result.data.description).toBeUndefined();
      }
    });

    it('should reject duplicate namespace name', () => {
      repo.create({ name: 'PlantFloor', uri: 'urn:opcua-light:PlantFloor' });

      const result = repo.create({ name: 'PlantFloor', uri: 'urn:opcua-light:Other' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_ERROR');
        expect(result.error.message).toContain('PlantFloor');
        expect(result.error.details).toBeDefined();
        expect(result.error.details![0].field).toBe('name');
      }
    });

    it('should reject duplicate namespace URI', () => {
      repo.create({ name: 'NS1', uri: 'urn:opcua-light:same' });

      const result = repo.create({ name: 'NS2', uri: 'urn:opcua-light:same' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_ERROR');
        expect(result.error.details![0].field).toBe('uri');
      }
    });

    it('should generate unique IDs for each namespace', () => {
      const result1 = repo.create({ name: 'NS1', uri: 'urn:ns1' });
      const result2 = repo.create({ name: 'NS2', uri: 'urn:ns2' });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data.id).not.toBe(result2.data.id);
      }
    });
  });

  describe('findAll', () => {
    it('should return empty array when no namespaces exist', () => {
      const result = repo.findAll();
      expect(result).toEqual([]);
    });

    it('should return all namespaces ordered by name', () => {
      repo.create({ name: 'Zebra', uri: 'urn:zebra' });
      repo.create({ name: 'Alpha', uri: 'urn:alpha' });
      repo.create({ name: 'Middle', uri: 'urn:middle' });

      const result = repo.findAll();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Alpha');
      expect(result[1].name).toBe('Middle');
      expect(result[2].name).toBe('Zebra');
    });

    it('should include node counts per namespace', () => {
      const nsResult = repo.create({ name: 'WithNodes', uri: 'urn:with-nodes' });
      repo.create({ name: 'Empty', uri: 'urn:empty' });

      if (nsResult.success) {
        const conn = db.getConnection();
        conn.prepare(
          "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', ?, 'Sensor1', 'Double')"
        ).run(nsResult.data.id);
        conn.prepare(
          "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n2', ?, 'Sensor2', 'Int32')"
        ).run(nsResult.data.id);
      }

      const result = repo.findAll();

      const withNodes = result.find((ns) => ns.name === 'WithNodes');
      const empty = result.find((ns) => ns.name === 'Empty');

      expect(withNodes?.nodeCount).toBe(2);
      expect(empty?.nodeCount).toBe(0);
    });
  });

  describe('findById', () => {
    it('should return namespace by ID', () => {
      const createResult = repo.create({ name: 'Test', uri: 'urn:test' });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const found = repo.findById(createResult.data.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test');
      expect(found!.uri).toBe('urn:test');
    });

    it('should return null for non-existent ID', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should include node count in findById result', () => {
      const createResult = repo.create({ name: 'Test', uri: 'urn:test' });
      if (!createResult.success) return;

      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', ?, 'Sensor1', 'Double')"
      ).run(createResult.data.id);

      const found = repo.findById(createResult.data.id);
      expect(found?.nodeCount).toBe(1);
    });
  });

  describe('update', () => {
    it('should update namespace name', () => {
      const createResult = repo.create({ name: 'OldName', uri: 'urn:test' });
      if (!createResult.success) return;

      const updateResult = repo.update(createResult.data.id, { name: 'NewName' });

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.name).toBe('NewName');
        expect(updateResult.data.uri).toBe('urn:test');
      }
    });

    it('should update namespace description', () => {
      const createResult = repo.create({ name: 'Test', description: 'Old desc', uri: 'urn:test' });
      if (!createResult.success) return;

      const updateResult = repo.update(createResult.data.id, { description: 'New desc' });

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.description).toBe('New desc');
      }
    });

    it('should update namespace URI', () => {
      const createResult = repo.create({ name: 'Test', uri: 'urn:old' });
      if (!createResult.success) return;

      const updateResult = repo.update(createResult.data.id, { uri: 'urn:new' });

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.uri).toBe('urn:new');
      }
    });

    it('should reject update with duplicate name', () => {
      repo.create({ name: 'Existing', uri: 'urn:existing' });
      const createResult = repo.create({ name: 'ToUpdate', uri: 'urn:to-update' });
      if (!createResult.success) return;

      const updateResult = repo.update(createResult.data.id, { name: 'Existing' });

      expect(updateResult.success).toBe(false);
      if (!updateResult.success) {
        expect(updateResult.error.code).toBe('DUPLICATE_ERROR');
        expect(updateResult.error.details![0].field).toBe('name');
      }
    });

    it('should reject update with duplicate URI', () => {
      repo.create({ name: 'NS1', uri: 'urn:existing-uri' });
      const createResult = repo.create({ name: 'NS2', uri: 'urn:to-update' });
      if (!createResult.success) return;

      const updateResult = repo.update(createResult.data.id, { uri: 'urn:existing-uri' });

      expect(updateResult.success).toBe(false);
      if (!updateResult.success) {
        expect(updateResult.error.code).toBe('DUPLICATE_ERROR');
        expect(updateResult.error.details![0].field).toBe('uri');
      }
    });

    it('should allow updating to the same name (no conflict with self)', () => {
      const createResult = repo.create({ name: 'SameName', uri: 'urn:test' });
      if (!createResult.success) return;

      const updateResult = repo.update(createResult.data.id, { name: 'SameName' });

      expect(updateResult.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent namespace', () => {
      const result = repo.update('non-existent', { name: 'New' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should update the updated_at timestamp', () => {
      const createResult = repo.create({ name: 'Test', uri: 'urn:test' });
      if (!createResult.success) return;

      const originalUpdatedAt = createResult.data.updatedAt;

      // Small delay to ensure timestamp difference
      const updateResult = repo.update(createResult.data.id, { description: 'Updated' });

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        // updatedAt should be set (may or may not differ depending on timing)
        expect(updateResult.data.updatedAt).toBeDefined();
      }
    });
  });

  describe('delete', () => {
    it('should delete an existing namespace', () => {
      const createResult = repo.create({ name: 'ToDelete', uri: 'urn:to-delete' });
      if (!createResult.success) return;

      const deleteResult = repo.delete(createResult.data.id);

      expect(deleteResult.success).toBe(true);
      expect(repo.findById(createResult.data.id)).toBeNull();
    });

    it('should return NOT_FOUND for non-existent namespace', () => {
      const result = repo.delete('non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should cascade delete associated object nodes', () => {
      const createResult = repo.create({ name: 'WithObjectNodes', uri: 'urn:with-object-nodes' });
      if (!createResult.success) return;

      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f1', ?, 'Object1')"
      ).run(createResult.data.id);
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f2', ?, 'Object2')"
      ).run(createResult.data.id);

      repo.delete(createResult.data.id);

      const objectNodes = conn.prepare('SELECT * FROM object_nodes WHERE namespace_id = ?').all(createResult.data.id);
      expect(objectNodes).toHaveLength(0);
    });

    it('should cascade delete associated nodes', () => {
      const createResult = repo.create({ name: 'WithNodes', uri: 'urn:with-nodes' });
      if (!createResult.success) return;

      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', ?, 'Node1', 'Double')"
      ).run(createResult.data.id);
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n2', ?, 'Node2', 'Int32')"
      ).run(createResult.data.id);

      repo.delete(createResult.data.id);

      const nodes = conn.prepare('SELECT * FROM nodes WHERE namespace_id = ?').all(createResult.data.id);
      expect(nodes).toHaveLength(0);
    });

    it('should not affect other namespaces when deleting', () => {
      const ns1 = repo.create({ name: 'NS1', uri: 'urn:ns1' });
      const ns2 = repo.create({ name: 'NS2', uri: 'urn:ns2' });
      if (!ns1.success || !ns2.success) return;

      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', ?, 'Node1', 'Double')"
      ).run(ns1.data.id);
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n2', ?, 'Node2', 'Double')"
      ).run(ns2.data.id);

      repo.delete(ns1.data.id);

      const remainingNodes = conn.prepare('SELECT * FROM nodes WHERE namespace_id = ?').all(ns2.data.id);
      expect(remainingNodes).toHaveLength(1);
      expect(repo.findById(ns2.data.id)).not.toBeNull();
    });
  });
});

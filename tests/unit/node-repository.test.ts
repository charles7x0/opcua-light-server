import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import { NodeRepository } from '../../src/db/repositories/node-repository.js';
import type { CreateNodeRequest, UpdateNodeRequest } from '../../src/types/api.js';

describe('NodeRepository', () => {
  let db: Database;
  let repo: NodeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new NodeRepository(db);

    // Insert a namespace for nodes to reference
    const conn = db.getConnection();
    conn
      .prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNamespace', 'urn:test:ns1')"
      )
      .run();
    conn
      .prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns2', 'OtherNamespace', 'urn:test:ns2')"
      )
      .run();
    conn
      .prepare(
        "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f1', 'ns1', 'Object1')"
      )
      .run();
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a node with all fields', () => {
      const request: CreateNodeRequest = {
        name: 'Temperature',
        namespaceId: 'ns1',
        objectNodeId: 'f1',
        dataType: 'Double',
        initialValue: 25.5,
        description: 'Temperature sensor',
      };

      const result = repo.create(request);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe('Temperature');
      expect(result.data.namespaceId).toBe('ns1');
      expect(result.data.objectNodeId).toBe('f1');
      expect(result.data.dataType).toBe('Double');
      expect(result.data.initialValue).toBe(25.5);
      expect(result.data.description).toBe('Temperature sensor');
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
    });

    it('should create a node with minimal required fields', () => {
      const request: CreateNodeRequest = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Int32',
      };

      const result = repo.create(request);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toBeDefined();
      expect(result.data.name).toBe('Sensor1');
      expect(result.data.namespaceId).toBe('ns1');
      expect(result.data.objectNodeId).toBeNull();
      expect(result.data.dataType).toBe('Int32');
      expect(result.data.initialValue).toBeUndefined();
      expect(result.data.description).toBeUndefined();
    });

    it('should store initialValue as JSON and parse it back', () => {
      const request: CreateNodeRequest = {
        name: 'BoolNode',
        namespaceId: 'ns1',
        dataType: 'Boolean',
        initialValue: true,
      };

      const result = repo.create(request);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.initialValue).toBe(true);

      // Verify it's stored as JSON in the database
      const conn = db.getConnection();
      const row = conn
        .prepare('SELECT initial_value FROM nodes WHERE id = ?')
        .get(result.data.id) as { initial_value: string };
      expect(row.initial_value).toBe('true');
    });

    it('should store string initialValue as JSON', () => {
      const request: CreateNodeRequest = {
        name: 'StringNode',
        namespaceId: 'ns1',
        dataType: 'String',
        initialValue: 'hello world',
      };

      const result = repo.create(request);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.initialValue).toBe('hello world');
    });

    it('should return validation error when name is missing', () => {
      const request = {
        name: '',
        namespaceId: 'ns1',
        dataType: 'Double',
      } as CreateNodeRequest;

      const result = repo.create(request);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('name');
    });

    it('should return validation error when namespaceId is missing', () => {
      const request = {
        name: 'Sensor1',
        namespaceId: '',
        dataType: 'Double',
      } as CreateNodeRequest;

      const result = repo.create(request);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('namespaceId');
    });

    it('should return validation error when dataType is missing', () => {
      const request = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: '' as any,
      } as CreateNodeRequest;

      const result = repo.create(request);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('dataType');
    });

    it('should return validation error for unsupported dataType', () => {
      const request = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Complex128' as any,
      } as CreateNodeRequest;

      const result = repo.create(request);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('Unsupported data type');
    });

    it('should return duplicate error for same name in same namespace', () => {
      const request: CreateNodeRequest = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      };

      repo.create(request);
      const result = repo.create(request);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('DUPLICATE_ERROR');
      expect(result.error.details![0].field).toBe('name');
    });

    it('should allow same name in different namespaces', () => {
      const request1: CreateNodeRequest = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      };
      const request2: CreateNodeRequest = {
        name: 'Sensor1',
        namespaceId: 'ns2',
        dataType: 'Int32',
      };

      const result1 = repo.create(request1);
      const result2 = repo.create(request2);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (!result1.success || !result2.success) return;
      expect(result1.data.id).not.toBe(result2.data.id);
      expect(result1.data.name).toBe(result2.data.name);
    });

    it('should include all validation errors when multiple fields are invalid', () => {
      const request = {
        name: '',
        namespaceId: '',
        dataType: '' as any,
      } as CreateNodeRequest;

      const result = repo.create(request);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.details).toHaveLength(3);
      const fields = result.error.details!.map((e) => e.field);
      expect(fields).toContain('name');
      expect(fields).toContain('namespaceId');
      expect(fields).toContain('dataType');
    });
  });

  describe('findAll', () => {
    it('should return empty array when no nodes exist', () => {
      const nodes = repo.findAll();
      expect(nodes).toEqual([]);
    });

    it('should return all nodes', () => {
      repo.create({ name: 'Node1', namespaceId: 'ns1', dataType: 'Double' });
      repo.create({ name: 'Node2', namespaceId: 'ns1', dataType: 'Int32' });
      repo.create({ name: 'Node3', namespaceId: 'ns2', dataType: 'Boolean' });

      const nodes = repo.findAll();
      expect(nodes).toHaveLength(3);
    });

    it('should filter by namespaceId when provided', () => {
      repo.create({ name: 'Node1', namespaceId: 'ns1', dataType: 'Double' });
      repo.create({ name: 'Node2', namespaceId: 'ns1', dataType: 'Int32' });
      repo.create({ name: 'Node3', namespaceId: 'ns2', dataType: 'Boolean' });

      const nodes = repo.findAll('ns1');
      expect(nodes).toHaveLength(2);
      expect(nodes.every((n) => n.namespaceId === 'ns1')).toBe(true);
    });

    it('should return nodes ordered by name', () => {
      repo.create({ name: 'Zebra', namespaceId: 'ns1', dataType: 'Double' });
      repo.create({ name: 'Alpha', namespaceId: 'ns1', dataType: 'Int32' });
      repo.create({ name: 'Middle', namespaceId: 'ns1', dataType: 'Boolean' });

      const nodes = repo.findAll();
      expect(nodes[0].name).toBe('Alpha');
      expect(nodes[1].name).toBe('Middle');
      expect(nodes[2].name).toBe('Zebra');
    });
  });

  describe('findById', () => {
    it('should return a node by ID', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
        initialValue: 42.0,
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const found = repo.findById(createResult.data.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(createResult.data.id);
      expect(found!.name).toBe('Sensor1');
      expect(found!.initialValue).toBe(42.0);
    });

    it('should return null for non-existent ID', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('should update node name', () => {
      const createResult = repo.create({
        name: 'OldName',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { name: 'NewName' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.name).toBe('NewName');
      expect(result.data.dataType).toBe('Double');
    });

    it('should update node dataType', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { dataType: 'Float' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.dataType).toBe('Float');
    });

    it('should update node initialValue', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
        initialValue: 0,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { initialValue: 99.9 });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.initialValue).toBe(99.9);
    });

    it('should update node objectNodeId', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { objectNodeId: 'f1' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.objectNodeId).toBe('f1');
    });

    it('should set objectNodeId to null', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        objectNodeId: 'f1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { objectNodeId: null });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.objectNodeId).toBeNull();
    });

    it('should return not found error for non-existent node', () => {
      const result = repo.update('non-existent', { name: 'NewName' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should return validation error for empty name', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { name: '' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.details![0].field).toBe('name');
    });

    it('should return validation error for unsupported dataType', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { dataType: 'Invalid' as any });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.details![0].field).toBe('dataType');
    });

    it('should return duplicate error when renaming to existing name in same namespace', () => {
      repo.create({ name: 'Sensor1', namespaceId: 'ns1', dataType: 'Double' });
      const createResult = repo.create({
        name: 'Sensor2',
        namespaceId: 'ns1',
        dataType: 'Int32',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.update(createResult.data.id, { name: 'Sensor1' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('DUPLICATE_ERROR');
    });

    it('should allow updating name to the same value', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Updating to the same name should succeed
      const result = repo.update(createResult.data.id, { name: 'Sensor1' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.name).toBe('Sensor1');
    });
  });

  describe('delete', () => {
    it('should delete an existing node', () => {
      const createResult = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const result = repo.delete(createResult.data.id);

      expect(result.success).toBe(true);
      expect(repo.findById(createResult.data.id)).toBeNull();
    });

    it('should return not found for non-existent node', () => {
      const result = repo.delete('non-existent-id');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });
});

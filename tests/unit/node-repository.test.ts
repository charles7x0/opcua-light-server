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

      const node = repo.create(request);

      expect(node.id).toBeDefined();
      expect(node.name).toBe('Temperature');
      expect(node.namespaceId).toBe('ns1');
      expect(node.objectNodeId).toBe('f1');
      expect(node.dataType).toBe('Double');
      expect(node.initialValue).toBe(25.5);
      expect(node.description).toBe('Temperature sensor');
      expect(node.createdAt).toBeDefined();
      expect(node.updatedAt).toBeDefined();
    });

    it('should create a node with minimal required fields', () => {
      const request: CreateNodeRequest = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Int32',
      };

      const node = repo.create(request);

      expect(node.id).toBeDefined();
      expect(node.name).toBe('Sensor1');
      expect(node.namespaceId).toBe('ns1');
      expect(node.objectNodeId).toBeNull();
      expect(node.dataType).toBe('Int32');
      expect(node.initialValue).toBeUndefined();
      expect(node.description).toBeUndefined();
    });

    it('should store initialValue as JSON and parse it back', () => {
      const request: CreateNodeRequest = {
        name: 'BoolNode',
        namespaceId: 'ns1',
        dataType: 'Boolean',
        initialValue: true,
      };

      const node = repo.create(request);
      expect(node.initialValue).toBe(true);

      // Verify it's stored as JSON in the database
      const conn = db.getConnection();
      const row = conn
        .prepare('SELECT initial_value FROM nodes WHERE id = ?')
        .get(node.id) as { initial_value: string };
      expect(row.initial_value).toBe('true');
    });

    it('should store string initialValue as JSON', () => {
      const request: CreateNodeRequest = {
        name: 'StringNode',
        namespaceId: 'ns1',
        dataType: 'String',
        initialValue: 'hello world',
      };

      const node = repo.create(request);
      expect(node.initialValue).toBe('hello world');
    });

    it('should throw validation error when name is missing', () => {
      const request = {
        name: '',
        namespaceId: 'ns1',
        dataType: 'Double',
      } as CreateNodeRequest;

      expect(() => repo.create(request)).toThrow('name');
    });

    it('should throw validation error when namespaceId is missing', () => {
      const request = {
        name: 'Sensor1',
        namespaceId: '',
        dataType: 'Double',
      } as CreateNodeRequest;

      expect(() => repo.create(request)).toThrow('namespaceId');
    });

    it('should throw validation error when dataType is missing', () => {
      const request = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: '' as any,
      } as CreateNodeRequest;

      expect(() => repo.create(request)).toThrow('dataType');
    });

    it('should throw validation error for unsupported dataType', () => {
      const request = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Complex128' as any,
      } as CreateNodeRequest;

      expect(() => repo.create(request)).toThrow('Unsupported data type');
    });

    it('should throw duplicate error for same name in same namespace', () => {
      const request: CreateNodeRequest = {
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      };

      repo.create(request);

      try {
        repo.create(request);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.isDuplicate).toBe(true);
        expect(err.validationErrors[0].field).toBe('name');
      }
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

      const node1 = repo.create(request1);
      const node2 = repo.create(request2);

      expect(node1.id).not.toBe(node2.id);
      expect(node1.name).toBe(node2.name);
    });

    it('should include all validation errors when multiple fields are invalid', () => {
      const request = {
        name: '',
        namespaceId: '',
        dataType: '' as any,
      } as CreateNodeRequest;

      try {
        repo.create(request);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.validationErrors).toHaveLength(3);
        const fields = err.validationErrors.map((e: any) => e.field);
        expect(fields).toContain('name');
        expect(fields).toContain('namespaceId');
        expect(fields).toContain('dataType');
      }
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
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
        initialValue: 42.0,
      });

      const found = repo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
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
      const created = repo.create({
        name: 'OldName',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      const updated = repo.update(created.id, { name: 'NewName' });

      expect(updated.name).toBe('NewName');
      expect(updated.dataType).toBe('Double');
    });

    it('should update node dataType', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      const updated = repo.update(created.id, { dataType: 'Float' });

      expect(updated.dataType).toBe('Float');
    });

    it('should update node initialValue', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
        initialValue: 0,
      });

      const updated = repo.update(created.id, { initialValue: 99.9 });

      expect(updated.initialValue).toBe(99.9);
    });

    it('should update node objectNodeId', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      const updated = repo.update(created.id, { objectNodeId: 'f1' });

      expect(updated.objectNodeId).toBe('f1');
    });

    it('should set objectNodeId to null', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        objectNodeId: 'f1',
        dataType: 'Double',
      });

      const updated = repo.update(created.id, { objectNodeId: null });

      expect(updated.objectNodeId).toBeNull();
    });

    it('should throw not found error for non-existent node', () => {
      try {
        repo.update('non-existent', { name: 'NewName' });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.isNotFound).toBe(true);
      }
    });

    it('should throw validation error for empty name', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      try {
        repo.update(created.id, { name: '' });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.validationErrors[0].field).toBe('name');
      }
    });

    it('should throw validation error for unsupported dataType', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      try {
        repo.update(created.id, { dataType: 'Invalid' as any });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.validationErrors[0].field).toBe('dataType');
      }
    });

    it('should throw duplicate error when renaming to existing name in same namespace', () => {
      repo.create({ name: 'Sensor1', namespaceId: 'ns1', dataType: 'Double' });
      const node2 = repo.create({
        name: 'Sensor2',
        namespaceId: 'ns1',
        dataType: 'Int32',
      });

      try {
        repo.update(node2.id, { name: 'Sensor1' });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.isDuplicate).toBe(true);
      }
    });

    it('should allow updating name to the same value', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      // Updating to the same name should not throw
      const updated = repo.update(created.id, { name: 'Sensor1' });
      expect(updated.name).toBe('Sensor1');
    });
  });

  describe('delete', () => {
    it('should delete an existing node', () => {
      const created = repo.create({
        name: 'Sensor1',
        namespaceId: 'ns1',
        dataType: 'Double',
      });

      const result = repo.delete(created.id);

      expect(result).toBe(true);
      expect(repo.findById(created.id)).toBeNull();
    });

    it('should return false for non-existent node', () => {
      const result = repo.delete('non-existent-id');
      expect(result).toBe(false);
    });
  });
});

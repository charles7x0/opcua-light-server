import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import {
  ObjectNodeRepository,
  ObjectNodeValidationError,
  ObjectNodeDuplicateError,
  ObjectNodeNotFoundError,
} from '../../src/db/repositories/object-node-repository.js';

describe('ObjectNodeRepository', () => {
  let db: Database;
  let repo: ObjectNodeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new ObjectNodeRepository(db);

    // Seed a namespace for testing
    const conn = db.getConnection();
    conn
      .prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNamespace', 'urn:test:ns1')"
      )
      .run();
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a root object node', () => {
      const objectNode = repo.create({
        namespaceId: 'ns1',
        name: 'RootObject',
      });

      expect(objectNode.id).toBeDefined();
      expect(objectNode.namespaceId).toBe('ns1');
      expect(objectNode.parentObjectNodeId).toBeNull();
      expect(objectNode.name).toBe('RootObject');
      expect(objectNode.createdAt).toBeDefined();
    });

    it('should create a child object node', () => {
      const parent = repo.create({
        namespaceId: 'ns1',
        name: 'Parent',
      });

      const child = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent.id,
        name: 'Child',
      });

      expect(child.parentObjectNodeId).toBe(parent.id);
      expect(child.name).toBe('Child');
    });

    it('should allow same name in different parents', () => {
      const parent1 = repo.create({
        namespaceId: 'ns1',
        name: 'Parent1',
      });

      const parent2 = repo.create({
        namespaceId: 'ns1',
        name: 'Parent2',
      });

      const child1 = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent1.id,
        name: 'SharedName',
      });

      const child2 = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent2.id,
        name: 'SharedName',
      });

      expect(child1.id).not.toBe(child2.id);
      expect(child1.name).toBe(child2.name);
    });

    it('should throw ObjectNodeDuplicateError for duplicate name in same parent', () => {
      repo.create({
        namespaceId: 'ns1',
        name: 'Duplicate',
      });

      expect(() =>
        repo.create({
          namespaceId: 'ns1',
          name: 'Duplicate',
        })
      ).toThrow(ObjectNodeDuplicateError);
    });

    it('should throw ObjectNodeDuplicateError for duplicate name in same child parent', () => {
      const parent = repo.create({
        namespaceId: 'ns1',
        name: 'Parent',
      });

      repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent.id,
        name: 'Child',
      });

      expect(() =>
        repo.create({
          namespaceId: 'ns1',
          parentObjectNodeId: parent.id,
          name: 'Child',
        })
      ).toThrow(ObjectNodeDuplicateError);
    });

    it('should throw ObjectNodeValidationError for non-existent namespace', () => {
      expect(() =>
        repo.create({
          namespaceId: 'nonexistent',
          name: 'Object',
        })
      ).toThrow(ObjectNodeValidationError);
    });

    it('should throw ObjectNodeValidationError for non-existent parent object node', () => {
      expect(() =>
        repo.create({
          namespaceId: 'ns1',
          parentObjectNodeId: 'nonexistent',
          name: 'Object',
        })
      ).toThrow(ObjectNodeValidationError);
    });

    it('should enforce maximum depth of 5 levels', () => {
      const level1 = repo.create({ namespaceId: 'ns1', name: 'Level1' });
      const level2 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level1.id, name: 'Level2' });
      const level3 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level2.id, name: 'Level3' });
      const level4 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level3.id, name: 'Level4' });
      const level5 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level4.id, name: 'Level5' });

      // Level 6 should fail
      expect(() =>
        repo.create({ namespaceId: 'ns1', parentObjectNodeId: level5.id, name: 'Level6' })
      ).toThrow(ObjectNodeValidationError);
      expect(() =>
        repo.create({ namespaceId: 'ns1', parentObjectNodeId: level5.id, name: 'Level6' })
      ).toThrow(/Maximum nesting depth/);
    });

    it('should allow creating at exactly 5 levels deep', () => {
      const level1 = repo.create({ namespaceId: 'ns1', name: 'L1' });
      const level2 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level1.id, name: 'L2' });
      const level3 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level2.id, name: 'L3' });
      const level4 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level3.id, name: 'L4' });
      const level5 = repo.create({ namespaceId: 'ns1', parentObjectNodeId: level4.id, name: 'L5' });

      expect(level5.name).toBe('L5');
    });
  });

  describe('findTreeByNamespace', () => {
    it('should return empty array for namespace with no object nodes', () => {
      const tree = repo.findTreeByNamespace('ns1');
      expect(tree).toEqual([]);
    });

    it('should return root object nodes', () => {
      repo.create({ namespaceId: 'ns1', name: 'Object1' });
      repo.create({ namespaceId: 'ns1', name: 'Object2' });

      const tree = repo.findTreeByNamespace('ns1');
      expect(tree).toHaveLength(2);
      expect(tree[0].name).toBe('Object1');
      expect(tree[1].name).toBe('Object2');
    });

    it('should return nested tree structure', () => {
      const root = repo.create({ namespaceId: 'ns1', name: 'Root' });
      const child = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: root.id,
        name: 'Child',
      });
      repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: child.id,
        name: 'Grandchild',
      });

      const tree = repo.findTreeByNamespace('ns1');
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('Root');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children![0].name).toBe('Child');
      expect(tree[0].children![0].children).toHaveLength(1);
      expect(tree[0].children![0].children![0].name).toBe('Grandchild');
    });

    it('should only return object nodes for the specified namespace', () => {
      const conn = db.getConnection();
      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns2', 'OtherNS', 'urn:test:ns2')"
        )
        .run();

      repo.create({ namespaceId: 'ns1', name: 'NS1Object' });
      repo.create({ namespaceId: 'ns2', name: 'NS2Object' });

      const tree = repo.findTreeByNamespace('ns1');
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('NS1Object');
    });
  });

  describe('delete', () => {
    it('should delete an object node', () => {
      const objectNode = repo.create({ namespaceId: 'ns1', name: 'ToDelete' });
      repo.delete(objectNode.id);

      const tree = repo.findTreeByNamespace('ns1');
      expect(tree).toHaveLength(0);
    });

    it('should throw ObjectNodeNotFoundError for non-existent object node', () => {
      expect(() => repo.delete('nonexistent')).toThrow(ObjectNodeNotFoundError);
    });

    it('should reassign variable nodes to parent object node on delete', () => {
      const conn = db.getConnection();
      const parent = repo.create({ namespaceId: 'ns1', name: 'Parent' });
      const child = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent.id,
        name: 'Child',
      });

      // Add a variable node to the child object node
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', ?, 'Sensor1', 'Double')"
        )
        .run(child.id);

      repo.delete(child.id);

      // Variable node should now be in the parent object node
      const node = conn
        .prepare("SELECT object_node_id FROM nodes WHERE id = 'n1'")
        .get() as { object_node_id: string | null };
      expect(node.object_node_id).toBe(parent.id);
    });

    it('should reassign variable nodes to null when deleting a root object node', () => {
      const conn = db.getConnection();
      const root = repo.create({ namespaceId: 'ns1', name: 'Root' });

      // Add a variable node to the root object node
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', ?, 'Sensor1', 'Double')"
        )
        .run(root.id);

      repo.delete(root.id);

      // Variable node should now have null object_node_id
      const node = conn
        .prepare("SELECT object_node_id FROM nodes WHERE id = 'n1'")
        .get() as { object_node_id: string | null };
      expect(node.object_node_id).toBeNull();
    });

    it('should reassign child object nodes to parent on delete', () => {
      const parent = repo.create({ namespaceId: 'ns1', name: 'Parent' });
      const middle = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent.id,
        name: 'Middle',
      });
      repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: middle.id,
        name: 'Child',
      });

      repo.delete(middle.id);

      const tree = repo.findTreeByNamespace('ns1');
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('Parent');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children![0].name).toBe('Child');
      expect(tree[0].children![0].parentObjectNodeId).toBe(parent.id);
    });

    it('should reassign multiple variable nodes to parent on delete', () => {
      const conn = db.getConnection();
      const parent = repo.create({ namespaceId: 'ns1', name: 'Parent' });
      const child = repo.create({
        namespaceId: 'ns1',
        parentObjectNodeId: parent.id,
        name: 'Child',
      });

      // Add multiple variable nodes to the child object node
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', ?, 'Sensor1', 'Double')"
        )
        .run(child.id);
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n2', 'ns1', ?, 'Sensor2', 'Int32')"
        )
        .run(child.id);

      repo.delete(child.id);

      // Both variable nodes should now be in the parent object node
      const nodes = conn
        .prepare('SELECT object_node_id FROM nodes WHERE namespace_id = ?')
        .all('ns1') as { object_node_id: string | null }[];
      expect(nodes).toHaveLength(2);
      expect(nodes.every((n) => n.object_node_id === parent.id)).toBe(true);
    });
  });
});

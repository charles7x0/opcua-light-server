import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Database } from '../../src/db/database.js';
import { ObjectNodeRepository } from '../../src/db/repositories/object-node-repository.js';
import type { ObjectNode } from '../../src/types/index.js';

/**
 * Property 4: Object Node Deletion Reassigns Variable Nodes to Parent
 *
 * For any object node containing variable nodes, deleting that object node SHALL
 * result in all previously-contained variable nodes being reassigned to the
 * object node's parent (or namespace root if no parent), with no nodes lost.
 */
describe('Property 4: Object Node Deletion Reassigns Variable Nodes to Parent', () => {
  let db: Database;
  let repo: ObjectNodeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new ObjectNodeRepository(db);

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

  const objectNodeNameArb = fc
    .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
      minLength: 1,
      maxLength: 20,
    });

  const nodeNameArb = fc
    .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
      minLength: 1,
      maxLength: 20,
    });

  const dataTypeArb = fc.constantFrom(
    'Boolean', 'Int16', 'Int32', 'Int64',
    'UInt16', 'UInt32', 'UInt64',
    'Float', 'Double', 'String', 'DateTime', 'ByteString'
  );

  it('should reassign all variable nodes to parent object node when deleted, with no nodes lost', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(objectNodeNameArb, { minLength: 1, maxLength: 5 }),
        fc.uniqueArray(nodeNameArb, { minLength: 1, maxLength: 5 }),
        fc.array(dataTypeArb, { minLength: 1, maxLength: 5 }),
        fc.nat(),
        (objectNodeNames, nodeNames, dataTypes, deleteIndex) => {
          if (objectNodeNames.length === 0 || nodeNames.length === 0) return;

          const nodeDataTypes = nodeNames.map((_, i) => dataTypes[i % dataTypes.length]);
          const conn = db.getConnection();

          // Create a linear chain of object nodes
          const objectNodes: ObjectNode[] = [];
          let parentId: string | null = null;

          for (const name of objectNodeNames) {
            const objectNode = repo.create({
              namespaceId: 'ns1',
              parentObjectNodeId: parentId,
              name,
            });
            objectNodes.push(objectNode);
            parentId = objectNode.id;
          }

          // Pick an object node to delete
          const targetIndex = deleteIndex % objectNodes.length;
          const targetNode = objectNodes[targetIndex];
          const expectedParentId = targetNode.parentObjectNodeId;

          // Assign variable nodes to the target object node
          for (let i = 0; i < nodeNames.length; i++) {
            conn
              .prepare(
                `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type)
                 VALUES (?, 'ns1', ?, ?, ?)`
              )
              .run(`node-${i}`, targetNode.id, nodeNames[i], nodeDataTypes[i]);
          }

          const totalNodesBefore = (
            conn.prepare("SELECT COUNT(*) as count FROM nodes WHERE namespace_id = 'ns1'").get() as { count: number }
          ).count;

          // Delete the target object node
          repo.delete(targetNode.id);

          // Verify reassignment
          const reassignedNodes = conn
            .prepare('SELECT id, object_node_id FROM nodes WHERE namespace_id = ?')
            .all('ns1') as { id: string; object_node_id: string | null }[];

          const nodesFromDeleted = reassignedNodes.filter((n) =>
            nodeNames.some((_, i) => n.id === `node-${i}`)
          );

          for (const node of nodesFromDeleted) {
            expect(node.object_node_id).toBe(expectedParentId);
          }

          // Verify no nodes lost
          const totalNodesAfter = (
            conn.prepare("SELECT COUNT(*) as count FROM nodes WHERE namespace_id = 'ns1'").get() as { count: number }
          ).count;

          expect(totalNodesAfter).toBe(totalNodesBefore);

          // Cleanup
          conn.prepare("DELETE FROM nodes WHERE namespace_id = 'ns1'").run();
          conn.prepare("DELETE FROM object_nodes WHERE namespace_id = 'ns1'").run();
        }
      ),
      { numRuns: 100 }
    );
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Database } from '../../src/db/database.js';
import { ObjectNodeRepository } from '../../src/db/repositories/object-node-repository.js';
import type { ObjectNode } from '../../src/types/index.js';

/**
 * Property 3: Object Node Tree Structure Correctness
 *
 * For any set of object nodes with parent-child relationships within a namespace,
 * the tree endpoint SHALL return a tree where every object node appears
 * exactly once and each node's children match the declared parent relationships.
 */

interface GeneratedObjectNode {
  name: string;
  parentIndex: number | null;
}

const objectNodeHierarchyArb = fc
  .integer({ min: 1, max: 15 })
  .chain((count) =>
    fc.array(
      fc.record({
        name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        parentIndex: fc.constant(null as number | null),
      }),
      { minLength: count, maxLength: count }
    )
  )
  .chain((nodes) => {
    return fc
      .tuple(
        ...nodes.map((node, index) => {
          if (index === 0) {
            return fc.constant({ name: node.name, parentIndex: null as number | null });
          }
          const validParents = Array.from({ length: index }, (_, i) => i);
          const options: fc.Arbitrary<number | null>[] = [fc.constant(null as number | null)];
          if (validParents.length > 0) {
            options.push(fc.constantFrom(...validParents));
          }
          return fc.oneof(...options).map((parentIndex) => ({
            name: node.name,
            parentIndex,
          }));
        })
      )
      .map((tuples) => tuples as GeneratedObjectNode[]);
  })
  .map((nodes) => {
    return nodes.map((n, i) => ({
      ...n,
      name: `ObjNode_${i}_${n.name.replace(/[^a-zA-Z0-9]/g, 'x')}`,
    }));
  })
  // Filter to ensure depth does not exceed 5
  .filter((nodes) => {
    const depths = new Map<number, number>();
    for (let i = 0; i < nodes.length; i++) {
      const parentIdx = nodes[i].parentIndex;
      if (parentIdx === null) {
        depths.set(i, 1);
      } else {
        depths.set(i, (depths.get(parentIdx) ?? 0) + 1);
      }
      if ((depths.get(i) ?? 0) > 5) return false;
    }
    return true;
  });

function flattenTree(tree: ObjectNode[]): ObjectNode[] {
  const result: ObjectNode[] = [];
  function walk(nodes: ObjectNode[]) {
    for (const node of nodes) {
      result.push(node);
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(tree);
  return result;
}

describe('Property 3: Object Node Tree Structure Correctness', () => {
  let db: Database;
  let repo: ObjectNodeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new ObjectNodeRepository(db);

    const conn = db.getConnection();
    conn
      .prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns-prop', 'PropertyTestNS', 'urn:test:property')"
      )
      .run();
  });

  afterEach(() => {
    db.close();
  });

  it('every created object node appears exactly once in the tree with correct parent-child relationships', () => {
    fc.assert(
      fc.property(objectNodeHierarchyArb, (hierarchy) => {
        const conn = db.getConnection();
        conn.prepare("DELETE FROM object_nodes WHERE namespace_id = 'ns-prop'").run();
        db.clearCache();

        const createdIds: string[] = [];
        const createdNodes: ObjectNode[] = [];

        for (const nodeDef of hierarchy) {
          const parentObjectNodeId =
            nodeDef.parentIndex !== null
              ? createdIds[nodeDef.parentIndex]
              : null;

          const created = repo.create({
            namespaceId: 'ns-prop',
            parentObjectNodeId,
            name: nodeDef.name,
          });

          createdIds.push(created.id);
          createdNodes.push(created);
        }

        const tree = repo.findTreeByNamespace('ns-prop');
        const flatTree = flattenTree(tree);

        const treeIds = flatTree.map((n) => n.id);
        const treeIdSet = new Set(treeIds);

        // No duplicates
        expect(treeIds.length).toBe(treeIdSet.size);

        // Every created node is present
        for (const created of createdNodes) {
          expect(treeIdSet.has(created.id)).toBe(true);
        }

        // No extra nodes
        expect(treeIds.length).toBe(createdNodes.length);

        // Children match parent relationships
        for (const treeNode of flatTree) {
          const expectedChildren = createdNodes.filter(
            (n) => n.parentObjectNodeId === treeNode.id
          );
          const actualChildren = treeNode.children ?? [];

          const expectedChildIds = new Set(expectedChildren.map((c) => c.id));
          const actualChildIds = new Set(actualChildren.map((c) => c.id));

          expect(actualChildIds).toEqual(expectedChildIds);
        }

        // Root nodes are those with null parentObjectNodeId
        const expectedRoots = createdNodes.filter(
          (n) => n.parentObjectNodeId === null
        );
        const actualRootIds = new Set(tree.map((n) => n.id));
        const expectedRootIds = new Set(expectedRoots.map((n) => n.id));

        expect(actualRootIds).toEqual(expectedRootIds);
      }),
      { numRuns: 100 }
    );
  });
});

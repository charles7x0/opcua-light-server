import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 3: Recursive deletion is post-order and exhaustive
 *
 * For any tree of object nodes (arbitrary depth and branching factor),
 * the Address_Space_Clearer shall visit every node in the tree exactly once,
 * and shall delete each parent node only after all its descendants have been
 * deleted (post-order).
 *
 * **Validates: Requirements 5.1, 5.2**
 */

// --- Tree data structure matching the C runtime's JSON model ---

interface ObjectNode {
  path: string;
  children: ObjectNode[];
}

// --- Reimplementation of the deletion traversal from address_space_clearer.c ---

/**
 * Mirrors `delete_object_nodes_recursive` from address_space_clearer.c:
 *
 * ```c
 * cJSON_ArrayForEach(obj_node, nodes_array) {
 *     if (cJSON_IsArray(children)) {
 *         delete_object_nodes_recursive(server, children, ns_index);
 *     }
 *     if (path) {
 *         UA_Server_deleteNode(server, objId, UA_TRUE);
 *     }
 * }
 * ```
 *
 * Instead of calling UA_Server_deleteNode, we record the path in deletionOrder.
 */
function deleteObjectNodesRecursive(nodes: ObjectNode[], deletionOrder: string[]): void {
  for (const node of nodes) {
    // Post-order: recurse into children first
    if (node.children.length > 0) {
      deleteObjectNodesRecursive(node.children, deletionOrder);
    }
    // Then "delete" this node (record its path)
    deletionOrder.push(node.path);
  }
}

// --- Helper: collect all node paths in a tree ---

function collectAllPaths(nodes: ObjectNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(node.path);
    if (node.children.length > 0) {
      paths.push(...collectAllPaths(node.children));
    }
  }
  return paths;
}

// --- Helper: get all descendants of a node (not including itself) ---

function getDescendants(node: ObjectNode): string[] {
  const descendants: string[] = [];
  for (const child of node.children) {
    descendants.push(child.path);
    descendants.push(...getDescendants(child));
  }
  return descendants;
}

// --- Helper: verify post-order for every node in the tree ---

function verifyPostOrder(nodes: ObjectNode[], deletionOrder: string[]): boolean {
  for (const node of nodes) {
    const nodeIndex = deletionOrder.indexOf(node.path);
    const descendants = getDescendants(node);

    // Every descendant must appear before this node in the deletion order
    for (const desc of descendants) {
      const descIndex = deletionOrder.indexOf(desc);
      if (descIndex >= nodeIndex) {
        return false;
      }
    }

    // Recursively check children subtrees
    if (!verifyPostOrder(node.children, deletionOrder)) {
      return false;
    }
  }
  return true;
}

// --- fast-check arbitrary for tree generation ---

/**
 * Generates random object node trees with:
 * - Depth: 1–5
 * - Branching factor: 0–4 at each level
 * - Unique paths at each node (using depth-first path encoding)
 */
function objectNodeArb(maxDepth: number, prefix: string): fc.Arbitrary<ObjectNode[]> {
  if (maxDepth <= 0) {
    // Leaf level: generate 0-4 leaf nodes
    return fc.integer({ min: 0, max: 4 }).chain((count) =>
      fc.constant(
        Array.from({ length: count }, (_, i) => ({
          path: `${prefix}/${i}`,
          children: [] as ObjectNode[],
        }))
      )
    );
  }

  // Generate 0-4 children, each potentially with their own subtree
  return fc.integer({ min: 0, max: 4 }).chain((count) => {
    if (count === 0) {
      return fc.constant([] as ObjectNode[]);
    }

    const childArbs = Array.from({ length: count }, (_, i) => {
      const childPrefix = `${prefix}/${i}`;
      // Each child can have children up to maxDepth-1
      return objectNodeArb(maxDepth - 1, childPrefix).map((grandchildren) => ({
        path: childPrefix,
        children: grandchildren,
      }));
    });

    return fc.tuple(...(childArbs as [fc.Arbitrary<ObjectNode>, ...fc.Arbitrary<ObjectNode>[]]));
  });
}

/**
 * Top-level tree arbitrary: depth 1-5, generates a root array of nodes.
 */
const treeArb: fc.Arbitrary<ObjectNode[]> = fc
  .integer({ min: 1, max: 5 })
  .chain((depth) =>
    fc.integer({ min: 1, max: 4 }).chain((rootCount) => {
      const rootArbs = Array.from({ length: rootCount }, (_, i) => {
        const prefix = `root_${i}`;
        return objectNodeArb(depth - 1, prefix).map((children) => ({
          path: prefix,
          children,
        }));
      });

      return fc.tuple(...(rootArbs as [fc.Arbitrary<ObjectNode>, ...fc.Arbitrary<ObjectNode>[]]));
    })
  );

describe('Feature: runtime-modular-refactor, Property 3: Recursive deletion is post-order and exhaustive', () => {
  it('deletion order is post-order: all descendants deleted before their parent', () => {
    fc.assert(
      fc.property(treeArb, (tree) => {
        const deletionOrder: string[] = [];
        deleteObjectNodesRecursive(tree, deletionOrder);

        // Verify post-order: for every node, all its descendants appear earlier
        expect(verifyPostOrder(tree, deletionOrder)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('deletion is exhaustive: every node appears exactly once in the deletion list', () => {
    fc.assert(
      fc.property(treeArb, (tree) => {
        const deletionOrder: string[] = [];
        deleteObjectNodesRecursive(tree, deletionOrder);

        // Collect all paths in the tree
        const allPaths = collectAllPaths(tree);

        // Every node in the tree must appear in the deletion order
        expect(deletionOrder.length).toBe(allPaths.length);

        // Check completeness: every path appears exactly once
        const deletionSet = new Set(deletionOrder);
        expect(deletionSet.size).toBe(deletionOrder.length); // No duplicates

        for (const path of allPaths) {
          expect(deletionSet.has(path)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

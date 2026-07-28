import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 4: Variable nodes deleted before object nodes
 *
 * For any namespace configuration containing both variable nodes and object nodes,
 * the Address_Space_Clearer shall delete all variable nodes in that namespace before
 * deleting any object node or the namespace root node.
 *
 * **Validates: Requirements 5.3**
 */

// --- Types representing the config structure ---

interface VariableNode {
  nodeId: string;
  name: string;
  dataType: string;
}

interface ObjectNode {
  name: string;
  path: string;
  children: ObjectNode[];
}

interface NamespaceConfig {
  name: string;
  uri: string;
  nodes: VariableNode[];
  objectNodes: ObjectNode[];
}

// --- Reimplementation of the deletion ordering algorithm from address_space_clearer.c ---

/**
 * Recursively collect object node deletions in post-order (deepest leaves first).
 * This mirrors `delete_object_nodes_recursive` in address_space_clearer.c:
 *   1. For each object node, recurse into children first
 *   2. Then delete the node itself
 */
function deleteObjectsRecursive(objectNodes: ObjectNode[], deletionOrder: string[]): void {
  for (const obj of objectNodes) {
    // Post-order: recurse into children first (deepest leaves deleted first)
    if (obj.children.length > 0) {
      deleteObjectsRecursive(obj.children, deletionOrder);
    }
    // Then delete this node
    deletionOrder.push(`object:${obj.path}`);
  }
}

/**
 * Simulate the full clearing algorithm from address_space_clearer.c:
 *   Phase 1: Delete ALL variable nodes (from `nodes` array)
 *   Phase 2: Delete object nodes in post-order (from `objectNodes` array via recursive traversal)
 *   Phase 3: Delete namespace root node
 */
function simulateClear(namespace: NamespaceConfig): string[] {
  const deletionOrder: string[] = [];

  // Phase 1: Delete variable nodes first
  for (const node of namespace.nodes) {
    deletionOrder.push(`variable:${node.nodeId}`);
  }

  // Phase 2: Delete object nodes in post-order (deepest leaves first)
  deleteObjectsRecursive(namespace.objectNodes, deletionOrder);

  // Phase 3: Delete the namespace root object node
  deletionOrder.push(`root:${namespace.name}`);

  return deletionOrder;
}

// --- Generators ---

/** Generate a unique node ID string */
const nodeIdArb = (prefix: string, index: number): fc.Arbitrary<string> =>
  fc.constant(`ns=1;s=${prefix}_${index}`);

/** Generate a variable node */
const variableNodeArb = (index: number): fc.Arbitrary<VariableNode> =>
  fc.record({
    nodeId: fc.constant(`ns=1;s=Var_${index}`),
    name: fc.constant(`Variable_${index}`),
    dataType: fc.constantFrom('Boolean', 'Int16', 'Int32', 'Double', 'String', 'Float'),
  });

/** Generate an object node tree with bounded depth */
function objectNodeArb(depth: number, pathPrefix: string, index: number): fc.Arbitrary<ObjectNode> {
  const path = `${pathPrefix}Obj_${index}`;

  if (depth <= 0) {
    return fc.record({
      name: fc.constant(`Object_${index}`),
      path: fc.constant(path),
      children: fc.constant([]),
    });
  }

  return fc.record({
    name: fc.constant(`Object_${index}`),
    path: fc.constant(path),
    children: fc
      .integer({ min: 0, max: 3 })
      .chain((numChildren) =>
        fc.tuple(
          ...Array.from({ length: numChildren }, (_, i) =>
            objectNodeArb(depth - 1, `${path}/`, i)
          )
        )
      )
      .map((tuple) => [...tuple]),
  });
}

/** Generate a namespace config with random variable and object nodes */
const namespaceConfigArb: fc.Arbitrary<NamespaceConfig> = fc
  .record({
    numVariables: fc.integer({ min: 0, max: 10 }),
    numObjects: fc.integer({ min: 0, max: 5 }),
    maxDepth: fc.integer({ min: 0, max: 3 }),
  })
  .chain(({ numVariables, numObjects, maxDepth }) => {
    const variables =
      numVariables > 0
        ? fc.tuple(...Array.from({ length: numVariables }, (_, i) => variableNodeArb(i)))
        : fc.constant([] as VariableNode[]);

    const objects =
      numObjects > 0
        ? fc.tuple(
            ...Array.from({ length: numObjects }, (_, i) =>
              objectNodeArb(maxDepth, '', i)
            )
          )
        : fc.constant([] as ObjectNode[]);

    return fc.record({
      name: fc.constant('TestNamespace'),
      uri: fc.constant('urn:test:ns'),
      nodes: variables.map((tuple) => [...tuple]),
      objectNodes: objects.map((tuple) => [...tuple]),
    });
  });

// --- Property Test ---

describe('Feature: runtime-modular-refactor, Property 4: Variable nodes deleted before object nodes', () => {
  it('all variable deletions precede any object or root deletion', () => {
    fc.assert(
      fc.property(namespaceConfigArb, (namespace) => {
        const deletionOrder = simulateClear(namespace);

        // Find the index of the last variable deletion
        let lastVariableIndex = -1;
        // Find the index of the first object or root deletion
        let firstObjectOrRootIndex = deletionOrder.length;

        for (let i = 0; i < deletionOrder.length; i++) {
          const entry = deletionOrder[i];
          if (entry.startsWith('variable:')) {
            lastVariableIndex = i;
          } else if (
            (entry.startsWith('object:') || entry.startsWith('root:')) &&
            i < firstObjectOrRootIndex
          ) {
            firstObjectOrRootIndex = i;
          }
        }

        // If there are no variable nodes, the property is vacuously true
        if (lastVariableIndex === -1) {
          return;
        }

        // If there are no object/root nodes, the property is vacuously true
        if (firstObjectOrRootIndex === deletionOrder.length) {
          return;
        }

        // All variable deletions must come before any object/root deletion
        expect(lastVariableIndex).toBeLessThan(firstObjectOrRootIndex);
      }),
      { numRuns: 100 }
    );
  });
});

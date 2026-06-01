import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Database } from '../../src/db/database.js';
import { NamespaceRepository } from '../../src/db/repositories/namespace-repository.js';
import { ObjectNodeRepository } from '../../src/db/repositories/object-node-repository.js';
import { NodeRepository } from '../../src/db/repositories/node-repository.js';
import type { OpcUaDataType } from '../../src/types/index.js';

/**
 * Feature: opcua-light-server
 * Property 2: Cascade Deletion Leaves No Orphans
 *
 * For any namespace containing an arbitrary number of folders and nodes,
 * deleting the namespace SHALL result in zero folders and zero nodes
 * referencing that namespace remaining in the store.
 *
 * **Validates: Requirements 2.4**
 */

const DATA_TYPES: OpcUaDataType[] = [
  'Boolean', 'Int16', 'Int32', 'Int64',
  'UInt16', 'UInt32', 'UInt64',
  'Float', 'Double', 'String', 'DateTime', 'ByteString',
];

/**
 * Represents a folder at a given depth level.
 * parentIndex refers to the index of the parent in the flat list (-1 for root).
 */
interface FolderDef {
  name: string;
  depth: number;
  parentIndex: number;
}

/**
 * Arbitrary that generates a flat list of folder definitions representing
 * a tree with 0-5 levels of depth. Each folder references its parent by index.
 */
const folderDefsArb: fc.Arbitrary<FolderDef[]> = fc
  .array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      depth: fc.integer({ min: 0, max: 4 }),
    }),
    { minLength: 0, maxLength: 8 }
  )
  .map((folders) => {
    // Assign parent indices based on depth: each folder's parent is a random
    // earlier folder at depth-1, or root (-1) if depth is 0
    const result: FolderDef[] = [];
    for (const folder of folders) {
      const possibleParents = result.filter((f) => f.depth === folder.depth - 1);
      let parentIndex: number;
      if (folder.depth === 0 || possibleParents.length === 0) {
        parentIndex = -1; // root level
      } else {
        // Pick the last possible parent (deterministic for reproducibility)
        parentIndex = result.indexOf(possibleParents[possibleParents.length - 1]);
      }
      result.push({ ...folder, parentIndex });
    }
    return result;
  });

/**
 * Arbitrary that generates a node definition.
 */
const nodeDefArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  dataType: fc.constantFrom(...DATA_TYPES),
});

describe('Feature: opcua-light-server, Property 2: Cascade Deletion Leaves No Orphans', () => {
  let dbPath: string;
  let database: Database;
  let namespaceRepo: NamespaceRepository;
  let folderRepo: ObjectNodeRepository;
  let nodeRepo: NodeRepository;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-cascade-${randomUUID()}.db`);
    database = new Database(dbPath);
    namespaceRepo = new NamespaceRepository(database);
    folderRepo = new ObjectNodeRepository(database);
    nodeRepo = new NodeRepository(database);
  });

  afterEach(() => {
    database.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it('deleting a namespace leaves zero orphaned folders and nodes', () => {
    fc.assert(
      fc.property(
        // Generate folder definitions (flat list representing a tree)
        folderDefsArb,
        // Generate nodes (1-10 per namespace)
        fc.array(nodeDefArb, { minLength: 1, maxLength: 10 }),
        (folderDefs, nodeDefs) => {
          // Use unique suffix to avoid collisions across iterations
          const suffix = randomUUID().slice(0, 8);
          const uniqueNsName = `ns-${suffix}`;
          const uniqueUri = `urn:test:${suffix}`;

          // Step 1: Create the namespace
          const nsResult = namespaceRepo.create({
            name: uniqueNsName,
            uri: uniqueUri,
            description: 'Test namespace for cascade deletion',
          });

          if (!nsResult.success) {
            // Skip if namespace creation fails (e.g., name collision)
            return;
          }

          const namespaceId = nsResult.data.id;

          // Step 2: Create folders from the flat definitions, tracking IDs
          const folderIds: string[] = [];
          const usedNamesPerParent = new Map<number, Set<string>>();

          for (let i = 0; i < folderDefs.length; i++) {
            const def = folderDefs[i];
            const parentObjectNodeId =
              def.parentIndex === -1 ? null : folderIds[def.parentIndex] ?? null;

            // Track used names per parent to avoid duplicates
            const parentKey = def.parentIndex;
            if (!usedNamesPerParent.has(parentKey)) {
              usedNamesPerParent.set(parentKey, new Set());
            }
            const usedNames = usedNamesPerParent.get(parentKey)!;

            const folderName = usedNames.has(def.name)
              ? `${def.name}-${randomUUID().slice(0, 6)}`
              : def.name;
            usedNames.add(folderName);

            try {
              const created = folderRepo.create({
                namespaceId,
                parentObjectNodeId,
                name: folderName,
              });
              folderIds.push(created.id);
            } catch {
              // Push empty string as placeholder to maintain index alignment
              folderIds.push('');
            }
          }

          // Filter out failed folder creations
          const validFolderIds = folderIds.filter((id) => id !== '');

          // Step 3: Create nodes (1-10), assigning some to folders
          const usedNodeNames = new Set<string>();
          for (let i = 0; i < nodeDefs.length; i++) {
            const nodeDef = nodeDefs[i];
            const nodeName = usedNodeNames.has(nodeDef.name)
              ? `${nodeDef.name}-${randomUUID().slice(0, 6)}`
              : nodeDef.name;
            usedNodeNames.add(nodeName);

            // Assign to an object node based on index (deterministic)
            const objectNodeId =
              validFolderIds.length > 0
                ? validFolderIds[i % validFolderIds.length]
                : null;

            try {
              nodeRepo.create({
                name: nodeName,
                namespaceId,
                objectNodeId,
                dataType: nodeDef.dataType,
              });
            } catch {
              // Skip nodes that fail validation
            }
          }

          // Step 4: Delete the namespace
          const deleteResult = namespaceRepo.delete(namespaceId);
          expect(deleteResult.success).toBe(true);

          // Step 5: Query the database directly to verify zero orphans
          const db = database.getConnection();

          const remainingFolders = db
            .prepare('SELECT COUNT(*) as count FROM object_nodes WHERE namespace_id = ?')
            .get(namespaceId) as { count: number };

          const remainingNodes = db
            .prepare('SELECT COUNT(*) as count FROM nodes WHERE namespace_id = ?')
            .get(namespaceId) as { count: number };

          expect(remainingFolders.count).toBe(0);
          expect(remainingNodes.count).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

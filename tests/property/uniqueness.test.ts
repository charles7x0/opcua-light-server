import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Database } from '../../src/db/database.js';
import { NamespaceRepository } from '../../src/db/repositories/namespace-repository.js';
import { NodeRepository } from '../../src/db/repositories/node-repository.js';
import { ObjectNodeRepository, ObjectNodeDuplicateError } from '../../src/db/repositories/object-node-repository.js';
import type { OpcUaDataType } from '../../src/types/index.js';

/**
 * Property 6: Uniqueness Constraints Prevent Duplicates
 *
 * For any entity type with a uniqueness constraint (namespace name, node name
 * within namespace, object node name within parent), attempting to create a duplicate
 * SHALL be rejected with an error indicating the conflict, and the original
 * entity SHALL remain unchanged.
 */

const SUPPORTED_DATA_TYPES: OpcUaDataType[] = [
  'Boolean', 'Int16', 'Int32', 'Int64',
  'UInt16', 'UInt32', 'UInt64',
  'Float', 'Double', 'String', 'DateTime', 'ByteString',
];

const arbNamespaceName = fc.string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const arbUri = fc.string({ minLength: 1, maxLength: 100 })
  .map((s) => `urn:opcua-light:${s.replace(/\s/g, '-')}`);

const arbEntityName = fc.string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const arbDataType = fc.constantFrom(...SUPPORTED_DATA_TYPES);

describe('Property 6: Uniqueness Constraints Prevent Duplicates', { timeout: 60000 }, () => {
  let db: Database;
  let namespaceRepo: NamespaceRepository;
  let nodeRepo: NodeRepository;
  let objectNodeRepo: ObjectNodeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    namespaceRepo = new NamespaceRepository(db);
    nodeRepo = new NodeRepository(db);
    objectNodeRepo = new ObjectNodeRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('duplicate namespace name is rejected and original unchanged', () => {
    fc.assert(
      fc.property(
        arbNamespaceName,
        arbUri,
        arbUri.filter((u) => u.length > 0),
        (name, uri1, uri2Suffix) => {
          const uri2 = uri1 + '-dup-' + uri2Suffix;

          const first = namespaceRepo.create({ name, uri: uri1 });
          if (!first.success) return;

          const duplicate = namespaceRepo.create({ name, uri: uri2 });

          expect(duplicate.success).toBe(false);
          if (!duplicate.success) {
            expect(duplicate.error.code).toBe('DUPLICATE_ERROR');
            expect(duplicate.error.message).toContain(name);
          }

          const original = namespaceRepo.findById(first.data.id);
          expect(original).not.toBeNull();
          expect(original!.name).toBe(first.data.name);
          expect(original!.uri).toBe(first.data.uri);
          expect(original!.description).toBe(first.data.description);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('duplicate node name within same namespace is rejected and original unchanged', () => {
    fc.assert(
      fc.property(
        arbEntityName,
        arbDataType,
        arbDataType,
        (nodeName, dataType1, dataType2) => {
          const nsResult = namespaceRepo.create({
            name: `ns-${Date.now()}-${Math.random()}`,
            uri: `urn:test:${Date.now()}-${Math.random()}`,
          });
          if (!nsResult.success) return;

          const namespaceId = nsResult.data.id;

          const firstNode = nodeRepo.create({
            name: nodeName,
            namespaceId,
            dataType: dataType1,
          });

          let duplicateError: Error | null = null;
          try {
            nodeRepo.create({
              name: nodeName,
              namespaceId,
              dataType: dataType2,
            });
          } catch (err) {
            duplicateError = err as Error;
          }

          expect(duplicateError).not.toBeNull();
          expect((duplicateError as any).isDuplicate).toBe(true);
          expect(duplicateError!.message).toContain(nodeName);

          const original = nodeRepo.findById(firstNode.id);
          expect(original).not.toBeNull();
          expect(original!.name).toBe(firstNode.name);
          expect(original!.dataType).toBe(firstNode.dataType);
          expect(original!.namespaceId).toBe(firstNode.namespaceId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('duplicate object node name within same parent is rejected and original unchanged', () => {
    fc.assert(
      fc.property(
        arbEntityName,
        (objectNodeName) => {
          const nsResult = namespaceRepo.create({
            name: `ns-${Date.now()}-${Math.random()}`,
            uri: `urn:test:${Date.now()}-${Math.random()}`,
          });
          if (!nsResult.success) return;

          const namespaceId = nsResult.data.id;

          const firstObjectNode = objectNodeRepo.create({
            namespaceId,
            name: objectNodeName,
          });

          let duplicateError: Error | null = null;
          try {
            objectNodeRepo.create({
              namespaceId,
              name: objectNodeName,
            });
          } catch (err) {
            duplicateError = err as Error;
          }

          expect(duplicateError).not.toBeNull();
          expect(duplicateError).toBeInstanceOf(ObjectNodeDuplicateError);
          expect(duplicateError!.message).toContain(objectNodeName);

          const tree = objectNodeRepo.findTreeByNamespace(namespaceId);
          const originalInTree = tree.find((f) => f.id === firstObjectNode.id);
          expect(originalInTree).toBeDefined();
          expect(originalInTree!.name).toBe(firstObjectNode.name);
          expect(originalInTree!.namespaceId).toBe(firstObjectNode.namespaceId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('duplicate object node name within same parent object node is rejected and original unchanged', () => {
    fc.assert(
      fc.property(
        arbEntityName,
        arbEntityName,
        (parentName, childName) => {
          const nsResult = namespaceRepo.create({
            name: `ns-${Date.now()}-${Math.random()}`,
            uri: `urn:test:${Date.now()}-${Math.random()}`,
          });
          if (!nsResult.success) return;

          const namespaceId = nsResult.data.id;

          const parentNode = objectNodeRepo.create({
            namespaceId,
            name: parentName,
          });

          const firstChild = objectNodeRepo.create({
            namespaceId,
            parentObjectNodeId: parentNode.id,
            name: childName,
          });

          let duplicateError: Error | null = null;
          try {
            objectNodeRepo.create({
              namespaceId,
              parentObjectNodeId: parentNode.id,
              name: childName,
            });
          } catch (err) {
            duplicateError = err as Error;
          }

          expect(duplicateError).not.toBeNull();
          expect(duplicateError).toBeInstanceOf(ObjectNodeDuplicateError);

          const tree = objectNodeRepo.findTreeByNamespace(namespaceId);
          const parent = tree.find((f) => f.id === parentNode.id);
          expect(parent).toBeDefined();
          const originalChild = parent!.children!.find((f) => f.id === firstChild.id);
          expect(originalChild).toBeDefined();
          expect(originalChild!.name).toBe(firstChild.name);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('same object node name in different parents is allowed (no false rejection)', () => {
    fc.assert(
      fc.property(
        arbEntityName,
        arbEntityName,
        arbEntityName,
        (objectNodeName, parent1Name, parent2Name) => {
          fc.pre(parent1Name !== parent2Name);

          const nsResult = namespaceRepo.create({
            name: `ns-${Date.now()}-${Math.random()}`,
            uri: `urn:test:${Date.now()}-${Math.random()}`,
          });
          if (!nsResult.success) return;

          const namespaceId = nsResult.data.id;

          const parent1 = objectNodeRepo.create({ namespaceId, name: parent1Name });
          const parent2 = objectNodeRepo.create({ namespaceId, name: parent2Name });

          const child1 = objectNodeRepo.create({
            namespaceId,
            parentObjectNodeId: parent1.id,
            name: objectNodeName,
          });

          const child2 = objectNodeRepo.create({
            namespaceId,
            parentObjectNodeId: parent2.id,
            name: objectNodeName,
          });

          expect(child1.id).toBeDefined();
          expect(child2.id).toBeDefined();
          expect(child1.id).not.toBe(child2.id);
          expect(child1.name).toBe(objectNodeName);
          expect(child2.name).toBe(objectNodeName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('same node name in different namespaces is allowed (no false rejection)', () => {
    fc.assert(
      fc.property(
        arbEntityName,
        arbDataType,
        (nodeName, dataType) => {
          const ns1 = namespaceRepo.create({
            name: `ns1-${Date.now()}-${Math.random()}`,
            uri: `urn:test1:${Date.now()}-${Math.random()}`,
          });
          const ns2 = namespaceRepo.create({
            name: `ns2-${Date.now()}-${Math.random()}`,
            uri: `urn:test2:${Date.now()}-${Math.random()}`,
          });
          if (!ns1.success || !ns2.success) return;

          const node1 = nodeRepo.create({
            name: nodeName,
            namespaceId: ns1.data.id,
            dataType,
          });

          const node2 = nodeRepo.create({
            name: nodeName,
            namespaceId: ns2.data.id,
            dataType,
          });

          expect(node1.id).toBeDefined();
          expect(node2.id).toBeDefined();
          expect(node1.id).not.toBe(node2.id);
          expect(node1.name).toBe(nodeName);
          expect(node2.name).toBe(nodeName);
        }
      ),
      { numRuns: 100 }
    );
  });
});

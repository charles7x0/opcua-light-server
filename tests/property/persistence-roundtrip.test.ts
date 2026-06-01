import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Database } from '../../src/db/database.js';
import { NamespaceRepository } from '../../src/db/repositories/namespace-repository.js';
import { NodeRepository } from '../../src/db/repositories/node-repository.js';
import { ObjectNodeRepository } from '../../src/db/repositories/object-node-repository.js';
import { S7Repository } from '../../src/db/repositories/s7-repository.js';
import type { OpcUaDataType } from '../../src/types/index.js';

/**
 * Property 1: Entity Persistence Round-Trip
 *
 * For any valid entity (node, namespace, folder, S7 connection, or S7 mapping),
 * creating it via the repository and then retrieving it SHALL produce an entity
 * with identical field values (excluding server-generated timestamps and IDs).
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 7.1, 7.2, 10.1**
 */
describe('Feature: opcua-light-server, Property 1: Entity Persistence Round-Trip', () => {
  let db: Database;
  let namespaceRepo: NamespaceRepository;
  let nodeRepo: NodeRepository;
  let objectNodeRepo: ObjectNodeRepository;
  let s7Repo: S7Repository;

  beforeEach(() => {
    db = new Database(':memory:');
    namespaceRepo = new NamespaceRepository(db);
    nodeRepo = new NodeRepository(db);
    objectNodeRepo = new ObjectNodeRepository(db);
    s7Repo = new S7Repository(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- Arbitraries ---

  const alphanumericString = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,29}$/);

  const namespaceArb = fc.record({
    name: alphanumericString,
    uri: fc.stringMatching(/^urn:[a-zA-Z][a-zA-Z0-9]{0,19}$/),
    description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  });

  const dataTypes: OpcUaDataType[] = [
    'Boolean', 'Int16', 'Int32', 'Int64',
    'UInt16', 'UInt32', 'UInt64',
    'Float', 'Double', 'String', 'DateTime', 'ByteString',
  ];

  const dataTypeArb = fc.constantFrom(...dataTypes);

  const initialValueForType = (dataType: OpcUaDataType): fc.Arbitrary<unknown> => {
    switch (dataType) {
      case 'Boolean':
        return fc.boolean();
      case 'Int16':
        return fc.integer({ min: -32768, max: 32767 });
      case 'Int32':
        return fc.integer({ min: -2147483648, max: 2147483647 });
      case 'Int64':
        return fc.integer({ min: -1000000, max: 1000000 });
      case 'UInt16':
        return fc.integer({ min: 0, max: 65535 });
      case 'UInt32':
        return fc.integer({ min: 0, max: 4294967295 });
      case 'UInt64':
        return fc.integer({ min: 0, max: 1000000 });
      case 'Float':
      case 'Double':
        return fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true });
      case 'String':
        return fc.string({ minLength: 1, maxLength: 50 });
      case 'DateTime':
        return fc.date().map((d) => d.toISOString());
      case 'ByteString':
        return fc.string({ minLength: 1, maxLength: 20 });
      default:
        return fc.constant(null);
    }
  };

  const nodeArb = fc.record({
    name: alphanumericString,
    dataType: dataTypeArb,
    description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  }).chain((base) =>
    fc.record({
      ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, fc.constant(v)])),
      initialValue: fc.option(initialValueForType(base.dataType), { nil: undefined }),
    }) as fc.Arbitrary<{
      name: string;
      dataType: OpcUaDataType;
      description: string | undefined;
      initialValue: unknown;
    }>
  );

  const objectNodeNameArb = alphanumericString;

  const s7ConnectionArb = fc.record({
    name: alphanumericString,
    host: fc.tuple(
      fc.integer({ min: 1, max: 254 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 }),
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    rack: fc.integer({ min: 0, max: 7 }),
    slot: fc.integer({ min: 0, max: 31 }),
    pollingIntervalMs: fc.integer({ min: 100, max: 10000 }),
    reconnectIntervalMs: fc.integer({ min: 1000, max: 60000 }),
    enabled: fc.boolean(),
  });

  const s7MappingPlcAddressArb = fc.tuple(
    fc.integer({ min: 1, max: 999 }),
    fc.integer({ min: 0, max: 9999 }),
  ).map(([dbNum, offset]) => `DB${dbNum},REAL${offset}`);

  // --- Property Tests ---

  it('namespace persistence round-trip', () => {
    let counter = 0;
    fc.assert(
      fc.property(namespaceArb, (input) => {
        counter++;
        const uniqueName = `${input.name}_${counter}`;
        const uniqueUri = `${input.uri}_${counter}`;

        const createResult = namespaceRepo.create({
          name: uniqueName,
          uri: uniqueUri,
          description: input.description,
        });

        expect(createResult.success).toBe(true);
        if (!createResult.success) return;

        const retrieved = namespaceRepo.findById(createResult.data.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe(uniqueName);
        expect(retrieved!.uri).toBe(uniqueUri);
        if (input.description !== undefined) {
          expect(retrieved!.description).toBe(input.description);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('node persistence round-trip', () => {
    fc.assert(
      fc.property(nodeArb, (input) => {
        // Create a namespace first (required for nodes)
        const nsName = `ns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nsResult = namespaceRepo.create({
          name: nsName,
          uri: `urn:${nsName}`,
        });
        expect(nsResult.success).toBe(true);
        if (!nsResult.success) return;

        const node = nodeRepo.create({
          name: input.name,
          namespaceId: nsResult.data.id,
          dataType: input.dataType,
          initialValue: input.initialValue,
          description: input.description,
        });

        const retrieved = nodeRepo.findById(node.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe(input.name);
        expect(retrieved!.namespaceId).toBe(nsResult.data.id);
        expect(retrieved!.dataType).toBe(input.dataType);

        if (input.initialValue !== undefined) {
          expect(retrieved!.initialValue).toEqual(input.initialValue);
        }
        if (input.description !== undefined) {
          expect(retrieved!.description).toBe(input.description);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('object node persistence round-trip', () => {
    fc.assert(
      fc.property(objectNodeNameArb, (objectNodeName) => {
        // Create a namespace first (required for object nodes)
        const nsName = `ns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nsResult = namespaceRepo.create({
          name: nsName,
          uri: `urn:${nsName}`,
        });
        expect(nsResult.success).toBe(true);
        if (!nsResult.success) return;

        const objectNode = objectNodeRepo.create({
          namespaceId: nsResult.data.id,
          name: objectNodeName,
        });

        expect(objectNode.id).toBeDefined();
        expect(objectNode.name).toBe(objectNodeName);
        expect(objectNode.namespaceId).toBe(nsResult.data.id);
        expect(objectNode.parentObjectNodeId).toBeNull();

        // Retrieve via tree and verify
        const tree = objectNodeRepo.findTreeByNamespace(nsResult.data.id);
        const found = tree.find((f) => f.id === objectNode.id);
        expect(found).toBeDefined();
        expect(found!.name).toBe(objectNodeName);
        expect(found!.namespaceId).toBe(nsResult.data.id);
      }),
      { numRuns: 100 }
    );
  });

  it('S7 connection persistence round-trip', () => {
    fc.assert(
      fc.property(s7ConnectionArb, (input) => {
        const result = s7Repo.createConnection({
          name: input.name,
          host: input.host,
          rack: input.rack,
          slot: input.slot,
          pollingIntervalMs: input.pollingIntervalMs,
          reconnectIntervalMs: input.reconnectIntervalMs,
          enabled: input.enabled,
        });

        expect(result.success).toBe(true);
        if (!result.success) return;

        const retrieved = s7Repo.findConnectionById(result.data.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.name).toBe(input.name);
        expect(retrieved!.host).toBe(input.host);
        expect(retrieved!.rack).toBe(input.rack);
        expect(retrieved!.slot).toBe(input.slot);
        expect(retrieved!.pollingIntervalMs).toBe(input.pollingIntervalMs);
        expect(retrieved!.reconnectIntervalMs).toBe(input.reconnectIntervalMs);
        expect(retrieved!.enabled).toBe(input.enabled);
      }),
      { numRuns: 100 }
    );
  });

  it('S7 mapping persistence round-trip', () => {
    fc.assert(
      fc.property(s7MappingPlcAddressArb, (plcAddress) => {
        // Create prerequisite entities: namespace, node, and S7 connection
        const nsName = `ns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nsResult = namespaceRepo.create({
          name: nsName,
          uri: `urn:${nsName}`,
        });
        expect(nsResult.success).toBe(true);
        if (!nsResult.success) return;

        const nodeName = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const node = nodeRepo.create({
          name: nodeName,
          namespaceId: nsResult.data.id,
          dataType: 'Float',
        });

        const connName = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const connResult = s7Repo.createConnection({
          name: connName,
          host: '192.168.1.1',
          rack: 0,
          slot: 1,
        });
        expect(connResult.success).toBe(true);
        if (!connResult.success) return;

        const mappingResult = s7Repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: node.id,
          plcAddress: plcAddress,
        });

        expect(mappingResult.success).toBe(true);
        if (!mappingResult.success) return;

        const retrieved = s7Repo.findMappingById(mappingResult.data.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.connectionId).toBe(connResult.data.id);
        expect(retrieved!.nodeId).toBe(node.id);
        expect(retrieved!.plcAddress).toBe(plcAddress);
      }),
      { numRuns: 100 }
    );
  });
});

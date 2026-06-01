import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Database } from '../../src/db/database.js';
import { ConfigGenerator } from '../../src/config-generator/index.js';
import type { OpcUaDataType } from '../../src/types/index.js';

/**
 * Property 7: Configuration Serialization Round-Trip
 *
 * For any valid set of node definitions in the SQLite store, generating the JSON
 * configuration file, parsing it back, and regenerating it SHALL produce a
 * byte-equivalent JSON output.
 *
 * The key property: for the same database state, the config generator always
 * produces the same output (deterministic).
 *
 * **Validates: Requirements 5.3, 5.4**
 */
describe('Feature: opcua-light-server, Property 7: Configuration Serialization Round-Trip', () => {
  let db: Database;
  let generator: ConfigGenerator;

  beforeEach(() => {
    db = new Database(':memory:');
    generator = new ConfigGenerator(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- Arbitraries ---

  const alphanumericString = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,19}$/);

  const dataTypes: OpcUaDataType[] = [
    'Boolean', 'Int16', 'Int32', 'Int64',
    'UInt16', 'UInt32', 'UInt64',
    'Float', 'Double', 'String', 'DateTime', 'ByteString',
  ];

  const dataTypeArb = fc.constantFrom(...dataTypes);

  const initialValueForType = (dataType: OpcUaDataType): fc.Arbitrary<string | null> => {
    switch (dataType) {
      case 'Boolean':
        return fc.boolean().map((v) => JSON.stringify(v));
      case 'Int16':
        return fc.integer({ min: -32768, max: 32767 }).map((v) => JSON.stringify(v));
      case 'Int32':
        return fc.integer({ min: -2147483648, max: 2147483647 }).map((v) => JSON.stringify(v));
      case 'Int64':
        return fc.integer({ min: -1000000, max: 1000000 }).map((v) => JSON.stringify(v));
      case 'UInt16':
        return fc.integer({ min: 0, max: 65535 }).map((v) => JSON.stringify(v));
      case 'UInt32':
        return fc.integer({ min: 0, max: 4294967295 }).map((v) => JSON.stringify(v));
      case 'UInt64':
        return fc.integer({ min: 0, max: 1000000 }).map((v) => JSON.stringify(v));
      case 'Float':
      case 'Double':
        return fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }).map((v) => JSON.stringify(v));
      case 'String':
        return fc.string({ minLength: 1, maxLength: 20 }).map((v) => JSON.stringify(v));
      case 'DateTime':
        return fc.date({ min: new Date('2000-01-01'), max: new Date('2030-01-01') }).map((d) => JSON.stringify(d.toISOString()));
      case 'ByteString':
        return fc.string({ minLength: 1, maxLength: 10 }).map((v) => JSON.stringify(v));
      default:
        return fc.constant(null);
    }
  };

  /** Generate a node definition with a data type and optional initial value. */
  const nodeDefArb = fc.record({
    name: alphanumericString,
    dataType: dataTypeArb,
  }).chain((base) =>
    fc.record({
      name: fc.constant(base.name),
      dataType: fc.constant(base.dataType),
      initialValue: fc.option(initialValueForType(base.dataType), { nil: null }),
    })
  );

  /** Generate an object node definition (name only, hierarchy built separately). */
  const objectNodeNameArb = alphanumericString;

  /**
   * Generate a full address space configuration:
   * - 1-3 namespaces with random names and URIs
   * - 0-5 object nodes per namespace (with hierarchy)
   * - 1-5 nodes per namespace with random data types and initial values
   */
  const addressSpaceArb = fc.integer({ min: 1, max: 3 }).chain((nsCount) =>
    fc.tuple(
      // Namespace names (unique)
      fc.uniqueArray(alphanumericString, { minLength: nsCount, maxLength: nsCount }),
      // Namespace URIs (unique)
      fc.uniqueArray(
        fc.stringMatching(/^urn:[a-zA-Z][a-zA-Z0-9]{0,14}$/).map((u) => u),
        { minLength: nsCount, maxLength: nsCount }
      ),
      // Object nodes per namespace (0-5 per namespace)
      fc.array(
        fc.array(objectNodeNameArb, { minLength: 0, maxLength: 5 }),
        { minLength: nsCount, maxLength: nsCount }
      ),
      // Nodes per namespace (1-5 per namespace)
      fc.array(
        fc.array(nodeDefArb, { minLength: 1, maxLength: 5 }),
        { minLength: nsCount, maxLength: nsCount }
      ),
    )
  );

  // --- Helpers ---

  /**
   * Insert a full address space into the database.
   */
  function insertAddressSpace(
    localDb: Database,
    namespaceNames: string[],
    namespaceUris: string[],
    objectNodesPerNs: string[][],
    nodesPerNs: { name: string; dataType: string; initialValue: string | null }[][],
  ): void {
    const conn = localDb.getConnection();

    for (let nsIdx = 0; nsIdx < namespaceNames.length; nsIdx++) {
      const nsId = `ns_${nsIdx}`;
      const nsName = namespaceNames[nsIdx];
      const nsUri = namespaceUris[nsIdx];

      conn.prepare(
        'INSERT INTO namespaces (id, name, uri) VALUES (?, ?, ?)'
      ).run(nsId, nsName, nsUri);

      // Insert object nodes with hierarchy: first is root, subsequent ones
      // are children of the previous (creating a chain)
      const objNodeNames = objectNodesPerNs[nsIdx];
      // Deduplicate names within the namespace to avoid UNIQUE constraint violations
      const uniqueObjNodeNames: string[] = [];
      const seenObjNodeNames = new Set<string>();
      for (const name of objNodeNames) {
        if (!seenObjNodeNames.has(name)) {
          seenObjNodeNames.add(name);
          uniqueObjNodeNames.push(name);
        }
      }

      const objNodeIds: string[] = [];
      for (let fIdx = 0; fIdx < uniqueObjNodeNames.length; fIdx++) {
        const objNodeId = `on_${nsIdx}_${fIdx}`;
        // Build a chain: first has no parent, rest are children of previous
        const parentId = fIdx === 0 ? null : objNodeIds[fIdx - 1];
        conn.prepare(
          'INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES (?, ?, ?, ?)'
        ).run(objNodeId, nsId, parentId, uniqueObjNodeNames[fIdx]);
        objNodeIds.push(objNodeId);
      }

      // Insert variable nodes - deduplicate names within namespace
      const nodes = nodesPerNs[nsIdx];
      const seenNodeNames = new Set<string>();
      let nodeCounter = 0;
      for (const node of nodes) {
        if (seenNodeNames.has(node.name)) continue;
        seenNodeNames.add(node.name);

        const nodeId = `n_${nsIdx}_${nodeCounter}`;
        // Assign node to the last object node if any exist, otherwise null
        const objectNodeId = objNodeIds.length > 0 ? objNodeIds[objNodeIds.length - 1] : null;

        conn.prepare(
          'INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(nodeId, nsId, objectNodeId, node.name, node.dataType, node.initialValue);
        nodeCounter++;
      }
    }
  }

  // --- Helpers for fresh DB per iteration ---

  function withFreshDb(
    fn: (localDb: Database, localGenerator: ConfigGenerator) => void
  ): void {
    const localDb = new Database(':memory:');
    const localGenerator = new ConfigGenerator(localDb);
    try {
      fn(localDb, localGenerator);
    } finally {
      localDb.close();
    }
  }

  // --- Property Tests ---

  it('config generation is deterministic: two successive calls produce equivalent output (excluding generatedAt)', () => {
    fc.assert(
      fc.property(addressSpaceArb, ([namespaceNames, namespaceUris, objectNodesPerNs, nodesPerNs]) => {
        withFreshDb((localDb, localGenerator) => {
          // Insert random address space data
          insertAddressSpace(localDb, namespaceNames, namespaceUris, objectNodesPerNs, nodesPerNs);

          // Generate config twice
          const config1 = localGenerator.generate();
          const config2 = localGenerator.generate();

          // Exclude generatedAt (timestamp changes between calls)
          const { generatedAt: _ts1, ...rest1 } = config1;
          const { generatedAt: _ts2, ...rest2 } = config2;

          // The rest of the config must be identical
          expect(rest1).toEqual(rest2);

          // Also verify JSON serialization produces identical output
          const json1 = JSON.stringify(rest1, null, 2);
          const json2 = JSON.stringify(rest2, null, 2);
          expect(json1).toBe(json2);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('config serialization round-trip: serialize to JSON, parse back, compare with original (excluding generatedAt)', () => {
    fc.assert(
      fc.property(addressSpaceArb, ([namespaceNames, namespaceUris, objectNodesPerNs, nodesPerNs]) => {
        withFreshDb((localDb, localGenerator) => {
          // Insert random address space data
          insertAddressSpace(localDb, namespaceNames, namespaceUris, objectNodesPerNs, nodesPerNs);

          // Generate config
          const config = localGenerator.generate();

          // Serialize to JSON
          const jsonString = JSON.stringify(config, null, 2);

          // Parse back
          const parsed = JSON.parse(jsonString);

          // Compare excluding generatedAt
          const { generatedAt: _ts1, ...originalRest } = config;
          const { generatedAt: _ts2, ...parsedRest } = parsed;

          expect(parsedRest).toEqual(originalRest);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('config JSON round-trip produces byte-equivalent output: generate, serialize, parse, re-serialize', () => {
    fc.assert(
      fc.property(addressSpaceArb, ([namespaceNames, namespaceUris, objectNodesPerNs, nodesPerNs]) => {
        withFreshDb((localDb, localGenerator) => {
          // Insert random address space data
          insertAddressSpace(localDb, namespaceNames, namespaceUris, objectNodesPerNs, nodesPerNs);

          // Generate config
          const config = localGenerator.generate();

          // Remove generatedAt for comparison (it's a timestamp that changes)
          const { generatedAt: _, ...configWithoutTimestamp } = config;

          // Serialize to JSON
          const json1 = JSON.stringify(configWithoutTimestamp, null, 2);

          // Parse back and re-serialize
          const parsed = JSON.parse(json1);
          const json2 = JSON.stringify(parsed, null, 2);

          // Byte-equivalent output
          expect(json1).toBe(json2);
        });
      }),
      { numRuns: 100 }
    );
  });
});

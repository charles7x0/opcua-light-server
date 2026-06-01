import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import { S7Repository } from '../../src/db/repositories/s7-repository.js';

describe('S7Repository', () => {
  let db: Database;
  let repo: S7Repository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new S7Repository(db);
  });

  afterEach(() => {
    db.close();
  });

  /** Helper to create a namespace and node for mapping tests. */
  function createTestNode(nodeId: string = 'node-1', name: string = 'Sensor1'): string {
    const conn = db.getConnection();
    conn.prepare(
      "INSERT INTO namespaces (id, name, uri) VALUES ('ns-1', 'TestNS', 'urn:test')"
    ).run();
    conn.prepare(
      `INSERT INTO nodes (id, namespace_id, name, data_type) VALUES (?, 'ns-1', ?, 'Double')`
    ).run(nodeId, name);
    return nodeId;
  }

  /** Helper to create a second node. */
  function createSecondNode(nodeId: string = 'node-2', name: string = 'Sensor2'): string {
    const conn = db.getConnection();
    // Only insert namespace if it doesn't exist
    const existing = conn.prepare("SELECT id FROM namespaces WHERE id = 'ns-1'").get();
    if (!existing) {
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns-1', 'TestNS', 'urn:test')"
      ).run();
    }
    conn.prepare(
      `INSERT INTO nodes (id, namespace_id, name, data_type) VALUES (?, 'ns-1', ?, 'Double')`
    ).run(nodeId, name);
    return nodeId;
  }

  describe('S7 Connection CRUD', () => {
    describe('createConnection', () => {
      it('should create a connection with all fields', () => {
        const result = repo.createConnection({
          name: 'PLC1',
          host: '192.168.1.10',
          rack: 0,
          slot: 1,
          pollingIntervalMs: 500,
          reconnectIntervalMs: 3000,
          enabled: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe('PLC1');
          expect(result.data.host).toBe('192.168.1.10');
          expect(result.data.rack).toBe(0);
          expect(result.data.slot).toBe(1);
          expect(result.data.pollingIntervalMs).toBe(500);
          expect(result.data.reconnectIntervalMs).toBe(3000);
          expect(result.data.enabled).toBe(true);
          expect(result.data.id).toBeDefined();
          expect(result.data.createdAt).toBeDefined();
        }
      });

      it('should use default values for optional fields', () => {
        const result = repo.createConnection({
          name: 'PLC2',
          host: '192.168.1.20',
          rack: 0,
          slot: 2,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.pollingIntervalMs).toBe(1000);
          expect(result.data.reconnectIntervalMs).toBe(5000);
          expect(result.data.enabled).toBe(true);
        }
      });

      it('should create a disabled connection', () => {
        const result = repo.createConnection({
          name: 'PLC3',
          host: '192.168.1.30',
          rack: 0,
          slot: 1,
          enabled: false,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.enabled).toBe(false);
        }
      });

      it('should generate unique IDs for each connection', () => {
        const r1 = repo.createConnection({ name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1 });
        const r2 = repo.createConnection({ name: 'PLC2', host: '10.0.0.2', rack: 0, slot: 1 });

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        if (r1.success && r2.success) {
          expect(r1.data.id).not.toBe(r2.data.id);
        }
      });
    });

    describe('findAllConnections', () => {
      it('should return empty array when no connections exist', () => {
        const result = repo.findAllConnections();
        expect(result).toEqual([]);
      });

      it('should return all connections ordered by name', () => {
        repo.createConnection({ name: 'Zebra', host: '10.0.0.3', rack: 0, slot: 1 });
        repo.createConnection({ name: 'Alpha', host: '10.0.0.1', rack: 0, slot: 1 });
        repo.createConnection({ name: 'Middle', host: '10.0.0.2', rack: 0, slot: 1 });

        const result = repo.findAllConnections();

        expect(result).toHaveLength(3);
        expect(result[0].name).toBe('Alpha');
        expect(result[1].name).toBe('Middle');
        expect(result[2].name).toBe('Zebra');
      });
    });

    describe('findConnectionById', () => {
      it('should return connection by ID', () => {
        const createResult = repo.createConnection({
          name: 'PLC1',
          host: '192.168.1.10',
          rack: 0,
          slot: 1,
        });
        if (!createResult.success) return;

        const found = repo.findConnectionById(createResult.data.id);

        expect(found).not.toBeNull();
        expect(found!.name).toBe('PLC1');
        expect(found!.host).toBe('192.168.1.10');
      });

      it('should return null for non-existent ID', () => {
        const found = repo.findConnectionById('non-existent-id');
        expect(found).toBeNull();
      });
    });

    describe('deleteConnection', () => {
      it('should delete an existing connection', () => {
        const createResult = repo.createConnection({
          name: 'ToDelete',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!createResult.success) return;

        const deleteResult = repo.deleteConnection(createResult.data.id);

        expect(deleteResult.success).toBe(true);
        expect(repo.findConnectionById(createResult.data.id)).toBeNull();
      });

      it('should return NOT_FOUND for non-existent connection', () => {
        const result = repo.deleteConnection('non-existent');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
        }
      });

      it('should cascade delete associated mappings', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          plcAddress: 'DB1,REAL0',
        });

        repo.deleteConnection(connResult.data.id);

        const mappings = repo.findAllMappings(connResult.data.id);
        expect(mappings).toHaveLength(0);
      });
    });
  });

  describe('S7 Mapping CRUD', () => {
    describe('createMapping', () => {
      it('should create a mapping with valid data', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        const result = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          plcAddress: 'DB1,REAL0',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.connectionId).toBe(connResult.data.id);
          expect(result.data.nodeId).toBe(nodeId);
          expect(result.data.plcAddress).toBe('DB1,REAL0');
          expect(result.data.id).toBeDefined();
          expect(result.data.createdAt).toBeDefined();
        }
      });

      it('should reject mapping for non-existent connection', () => {
        const nodeId = createTestNode();

        const result = repo.createMapping({
          connectionId: 'non-existent-conn',
          nodeId,
          plcAddress: 'DB1,REAL0',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
          expect(result.error.message).toContain('non-existent-conn');
          expect(result.error.details![0].field).toBe('connectionId');
        }
      });

      it('should reject mapping for non-existent node', () => {
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        const result = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: 'non-existent-node',
          plcAddress: 'DB1,REAL0',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
          expect(result.error.message).toContain('non-existent-node');
          expect(result.error.details![0].field).toBe('nodeId');
        }
      });

      it('should reject duplicate mapping for the same node (one mapping per node)', () => {
        const nodeId = createTestNode();
        const conn1 = repo.createConnection({ name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1 });
        const conn2 = repo.createConnection({ name: 'PLC2', host: '10.0.0.2', rack: 0, slot: 1 });
        if (!conn1.success || !conn2.success) return;

        // First mapping succeeds
        const first = repo.createMapping({
          connectionId: conn1.data.id,
          nodeId,
          plcAddress: 'DB1,REAL0',
        });
        expect(first.success).toBe(true);

        // Second mapping to same node should fail
        const second = repo.createMapping({
          connectionId: conn2.data.id,
          nodeId,
          plcAddress: 'DB2,REAL0',
        });

        expect(second.success).toBe(false);
        if (!second.success) {
          expect(second.error.code).toBe('DUPLICATE_ERROR');
          expect(second.error.message).toContain(nodeId);
          expect(second.error.details![0].field).toBe('nodeId');
        }
      });

      it('should reject duplicate PLC address within the same connection', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createSecondNode('node-2', 'Sensor2');
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        // First mapping succeeds
        const first = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: nodeId1,
          plcAddress: 'DB1,REAL0',
        });
        expect(first.success).toBe(true);

        // Second mapping with same PLC address on same connection should fail
        const second = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: nodeId2,
          plcAddress: 'DB1,REAL0',
        });

        expect(second.success).toBe(false);
        if (!second.success) {
          expect(second.error.code).toBe('DUPLICATE_ERROR');
          expect(second.error.message).toContain('DB1,REAL0');
          expect(second.error.details![0].field).toBe('plcAddress');
        }
      });

      it('should allow same PLC address on different connections', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createSecondNode('node-2', 'Sensor2');
        const conn1 = repo.createConnection({ name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1 });
        const conn2 = repo.createConnection({ name: 'PLC2', host: '10.0.0.2', rack: 0, slot: 1 });
        if (!conn1.success || !conn2.success) return;

        const first = repo.createMapping({
          connectionId: conn1.data.id,
          nodeId: nodeId1,
          plcAddress: 'DB1,REAL0',
        });
        const second = repo.createMapping({
          connectionId: conn2.data.id,
          nodeId: nodeId2,
          plcAddress: 'DB1,REAL0',
        });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
      });
    });

    describe('findAllMappings', () => {
      it('should return empty array when no mappings exist', () => {
        const result = repo.findAllMappings();
        expect(result).toEqual([]);
      });

      it('should return all mappings', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createSecondNode('node-2', 'Sensor2');
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId1, plcAddress: 'DB1,REAL0' });
        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId2, plcAddress: 'DB1,REAL4' });

        const result = repo.findAllMappings();
        expect(result).toHaveLength(2);
      });

      it('should filter mappings by connectionId', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createSecondNode('node-2', 'Sensor2');
        const conn1 = repo.createConnection({ name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1 });
        const conn2 = repo.createConnection({ name: 'PLC2', host: '10.0.0.2', rack: 0, slot: 1 });
        if (!conn1.success || !conn2.success) return;

        repo.createMapping({ connectionId: conn1.data.id, nodeId: nodeId1, plcAddress: 'DB1,REAL0' });
        repo.createMapping({ connectionId: conn2.data.id, nodeId: nodeId2, plcAddress: 'DB1,REAL0' });

        const result = repo.findAllMappings(conn1.data.id);
        expect(result).toHaveLength(1);
        expect(result[0].connectionId).toBe(conn1.data.id);
      });
    });

    describe('findMappingById', () => {
      it('should return mapping by ID', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        const createResult = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          plcAddress: 'DB1,REAL0',
        });
        if (!createResult.success) return;

        const found = repo.findMappingById(createResult.data.id);

        expect(found).not.toBeNull();
        expect(found!.plcAddress).toBe('DB1,REAL0');
        expect(found!.nodeId).toBe(nodeId);
      });

      it('should return null for non-existent ID', () => {
        const found = repo.findMappingById('non-existent-id');
        expect(found).toBeNull();
      });
    });

    describe('deleteMapping', () => {
      it('should delete an existing mapping', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        const createResult = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          plcAddress: 'DB1,REAL0',
        });
        if (!createResult.success) return;

        const deleteResult = repo.deleteMapping(createResult.data.id);

        expect(deleteResult.success).toBe(true);
        expect(repo.findMappingById(createResult.data.id)).toBeNull();
      });

      it('should return NOT_FOUND for non-existent mapping', () => {
        const result = repo.deleteMapping('non-existent');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
        }
      });

      it('should allow creating a new mapping for the same node after deletion', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection({
          name: 'PLC1',
          host: '10.0.0.1',
          rack: 0,
          slot: 1,
        });
        if (!connResult.success) return;

        // Create and delete first mapping
        const first = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          plcAddress: 'DB1,REAL0',
        });
        if (!first.success) return;
        repo.deleteMapping(first.data.id);

        // Should be able to create a new mapping for the same node
        const second = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          plcAddress: 'DB1,REAL4',
        });

        expect(second.success).toBe(true);
      });
    });
  });
});

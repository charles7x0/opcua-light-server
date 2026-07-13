import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/db/database.js';
import { ConnectorRepository } from '../../src/db/repositories/connector-repository.js';
import type { CreateConnectionRequest, CreateMappingRequest } from '../../src/db/repositories/connector-repository.js';

describe('ConnectorRepository', () => {
  let db: Database;
  let repo: ConnectorRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new ConnectorRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /** Helper to create a namespace and node for mapping tests. */
  function createTestNode(nodeId: string = 'node-1', name: string = 'Sensor1'): string {
    const conn = db.getConnection();
    const nsExists = conn.prepare("SELECT id FROM namespaces WHERE id = 'ns-1'").get();
    if (!nsExists) {
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns-1', 'TestNS', 'urn:test')"
      ).run();
    }
    conn.prepare(
      `INSERT INTO nodes (id, namespace_id, name, data_type) VALUES (?, 'ns-1', ?, 'Double')`
    ).run(nodeId, name);
    return nodeId;
  }

  /** Helper to create an S7 connection request. */
  function s7ConnectionRequest(name: string = 'PLC1'): CreateConnectionRequest {
    return {
      type: 's7',
      name,
      params: { host: '192.168.1.10', rack: 0, slot: 1 },
    };
  }

  /** Helper to create a Modbus connection request. */
  function modbusConnectionRequest(name: string = 'Modbus1'): CreateConnectionRequest {
    return {
      type: 'modbus-tcp',
      name,
      params: { host: '192.168.1.20', port: 502, unitId: 1 },
    };
  }

  // ─── Connection CRUD ────────────────────────────────────────────────────────

  describe('Connection CRUD', () => {
    describe('createConnection', () => {
      it('should create a connection with all fields', () => {
        const result = repo.createConnection({
          type: 's7',
          name: 'PLC1',
          params: { host: '192.168.1.10', rack: 0, slot: 1 },
          pollingIntervalMs: 500,
          reconnectIntervalMs: 3000,
          enabled: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe('s7');
          expect(result.data.name).toBe('PLC1');
          expect(result.data.params).toEqual({ host: '192.168.1.10', rack: 0, slot: 1 });
          expect(result.data.pollingIntervalMs).toBe(500);
          expect(result.data.reconnectIntervalMs).toBe(3000);
          expect(result.data.enabled).toBe(true);
          expect(result.data.id).toBeDefined();
          expect(result.data.createdAt).toBeDefined();
        }
      });

      it('should use default values for optional fields', () => {
        const result = repo.createConnection({
          type: 'modbus-tcp',
          name: 'Modbus1',
          params: { host: '192.168.1.20', port: 502, unitId: 1 },
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
          ...s7ConnectionRequest(),
          enabled: false,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.enabled).toBe(false);
        }
      });

      it('should generate unique IDs for each connection', () => {
        const r1 = repo.createConnection(s7ConnectionRequest('PLC1'));
        const r2 = repo.createConnection(modbusConnectionRequest('Modbus1'));

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        if (r1.success && r2.success) {
          expect(r1.data.id).not.toBe(r2.data.id);
        }
      });

      it('should serialize and deserialize params JSON correctly', () => {
        const params = { host: '10.0.0.1', port: 502, unitId: 3, nested: { key: 'value' } };
        const result = repo.createConnection({
          type: 'modbus-tcp',
          name: 'Complex',
          params,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.params).toEqual(params);
        }
      });
    });

    describe('findAllConnections', () => {
      it('should return empty array when no connections exist', () => {
        const result = repo.findAllConnections();
        expect(result).toEqual([]);
      });

      it('should return all connections ordered by name', () => {
        repo.createConnection({ ...s7ConnectionRequest('Zebra') });
        repo.createConnection({ ...modbusConnectionRequest('Alpha') });
        repo.createConnection({ ...s7ConnectionRequest('Middle') });

        const result = repo.findAllConnections();

        expect(result).toHaveLength(3);
        expect(result[0].name).toBe('Alpha');
        expect(result[1].name).toBe('Middle');
        expect(result[2].name).toBe('Zebra');
      });

      it('should filter connections by type', () => {
        repo.createConnection(s7ConnectionRequest('S7-PLC1'));
        repo.createConnection(modbusConnectionRequest('Modbus-Device1'));
        repo.createConnection(s7ConnectionRequest('S7-PLC2'));
        repo.createConnection({
          type: 'ethernet-ip',
          name: 'EIP-PLC1',
          params: { host: '10.0.0.5', port: 44818, slot: 0 },
        });

        const s7Only = repo.findAllConnections('s7');
        expect(s7Only).toHaveLength(2);
        expect(s7Only.every(c => c.type === 's7')).toBe(true);

        const modbusOnly = repo.findAllConnections('modbus-tcp');
        expect(modbusOnly).toHaveLength(1);
        expect(modbusOnly[0].type).toBe('modbus-tcp');

        const eipOnly = repo.findAllConnections('ethernet-ip');
        expect(eipOnly).toHaveLength(1);
        expect(eipOnly[0].type).toBe('ethernet-ip');
      });

      it('should return empty array when filtering by a type with no connections', () => {
        repo.createConnection(s7ConnectionRequest('PLC1'));

        const result = repo.findAllConnections('modbus-tcp');
        expect(result).toEqual([]);
      });
    });

    describe('findConnectionById', () => {
      it('should return connection by ID', () => {
        const createResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!createResult.success) return;

        const found = repo.findConnectionById(createResult.data.id);

        expect(found).not.toBeNull();
        expect(found!.name).toBe('PLC1');
        expect(found!.type).toBe('s7');
        expect(found!.params).toEqual({ host: '192.168.1.10', rack: 0, slot: 1 });
      });

      it('should return null for non-existent ID', () => {
        const found = repo.findConnectionById('non-existent-id');
        expect(found).toBeNull();
      });
    });

    describe('updateConnection', () => {
      it('should update specific fields only', () => {
        const createResult = repo.createConnection(s7ConnectionRequest('Original'));
        if (!createResult.success) return;

        const updateResult = repo.updateConnection(createResult.data.id, {
          name: 'Updated',
          pollingIntervalMs: 2000,
        });

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.name).toBe('Updated');
          expect(updateResult.data.pollingIntervalMs).toBe(2000);
          // Unchanged fields remain
          expect(updateResult.data.params).toEqual({ host: '192.168.1.10', rack: 0, slot: 1 });
          expect(updateResult.data.reconnectIntervalMs).toBe(5000);
        }
      });

      it('should update params JSON', () => {
        const createResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!createResult.success) return;

        const newParams = { host: '10.0.0.99', rack: 1, slot: 2 };
        const updateResult = repo.updateConnection(createResult.data.id, { params: newParams });

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.params).toEqual(newParams);
        }
      });

      it('should return NOT_FOUND for non-existent connection', () => {
        const result = repo.updateConnection('non-existent', { name: 'New' });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
        }
      });

      it('should return unchanged connection when no fields provided', () => {
        const createResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!createResult.success) return;

        const updateResult = repo.updateConnection(createResult.data.id, {});

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.name).toBe('PLC1');
        }
      });
    });

    describe('deleteConnection', () => {
      it('should delete an existing connection', () => {
        const createResult = repo.createConnection(s7ConnectionRequest('ToDelete'));
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
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });

        // Verify mapping exists
        const mappingsBefore = repo.findAllMappings(connResult.data.id);
        expect(mappingsBefore).toHaveLength(1);

        // Delete connection
        repo.deleteConnection(connResult.data.id);

        // Verify mapping was cascade deleted
        const mappingsAfter = repo.findAllMappings(connResult.data.id);
        expect(mappingsAfter).toHaveLength(0);
      });

      it('should cascade delete multiple mappings when connection is removed', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' });
        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL4' });

        expect(repo.findAllMappings(connResult.data.id)).toHaveLength(2);

        repo.deleteConnection(connResult.data.id);

        expect(repo.findAllMappings(connResult.data.id)).toHaveLength(0);
      });
    });
  });

  // ─── Mapping CRUD ──────────────────────────────────────────────────────────

  describe('Mapping CRUD', () => {
    describe('createMapping', () => {
      it('should create a mapping with valid data', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const result = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
          description: 'Temperature sensor',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.connectionId).toBe(connResult.data.id);
          expect(result.data.nodeId).toBe(nodeId);
          expect(result.data.deviceAddress).toBe('DB1,REAL0');
          expect(result.data.description).toBe('Temperature sensor');
          expect(result.data.id).toBeDefined();
          expect(result.data.createdAt).toBeDefined();
        }
      });

      it('should create a mapping without description', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const result = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.description).toBeUndefined();
        }
      });

      it('should reject mapping for non-existent connection', () => {
        const nodeId = createTestNode();

        const result = repo.createMapping({
          connectionId: 'non-existent-conn',
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
          expect(result.error.details![0].field).toBe('connectionId');
        }
      });

      it('should reject mapping for non-existent node', () => {
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const result = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: 'non-existent-node',
          deviceAddress: 'DB1,REAL0',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
          expect(result.error.details![0].field).toBe('nodeId');
        }
      });

      it('should reject duplicate mapping for the same node (one mapping per node)', () => {
        const nodeId = createTestNode();
        const conn1 = repo.createConnection(s7ConnectionRequest('PLC1'));
        const conn2 = repo.createConnection(modbusConnectionRequest('Modbus1'));
        if (!conn1.success || !conn2.success) return;

        const first = repo.createMapping({
          connectionId: conn1.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });
        expect(first.success).toBe(true);

        const second = repo.createMapping({
          connectionId: conn2.data.id,
          nodeId,
          deviceAddress: 'HR:100:1',
        });

        expect(second.success).toBe(false);
        if (!second.success) {
          expect(second.error.code).toBe('DUPLICATE_ERROR');
          expect(second.error.details![0].field).toBe('nodeId');
        }
      });

      it('should reject duplicate device address within the same connection', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const first = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: nodeId1,
          deviceAddress: 'DB1,REAL0',
        });
        expect(first.success).toBe(true);

        const second = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId: nodeId2,
          deviceAddress: 'DB1,REAL0',
        });

        expect(second.success).toBe(false);
        if (!second.success) {
          expect(second.error.code).toBe('DUPLICATE_ERROR');
          expect(second.error.details![0].field).toBe('deviceAddress');
        }
      });

      it('should allow same device address on different connections', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const conn1 = repo.createConnection(s7ConnectionRequest('PLC1'));
        const conn2 = repo.createConnection(s7ConnectionRequest('PLC2'));
        if (!conn1.success || !conn2.success) return;

        const first = repo.createMapping({
          connectionId: conn1.data.id,
          nodeId: nodeId1,
          deviceAddress: 'DB1,REAL0',
        });
        const second = repo.createMapping({
          connectionId: conn2.data.id,
          nodeId: nodeId2,
          deviceAddress: 'DB1,REAL0',
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
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' });
        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL4' });

        const result = repo.findAllMappings();
        expect(result).toHaveLength(2);
      });

      it('should filter mappings by connectionId', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const conn1 = repo.createConnection(s7ConnectionRequest('PLC1'));
        const conn2 = repo.createConnection(modbusConnectionRequest('Modbus1'));
        if (!conn1.success || !conn2.success) return;

        repo.createMapping({ connectionId: conn1.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' });
        repo.createMapping({ connectionId: conn2.data.id, nodeId: nodeId2, deviceAddress: 'HR:100:1' });

        const result = repo.findAllMappings(conn1.data.id);
        expect(result).toHaveLength(1);
        expect(result[0].connectionId).toBe(conn1.data.id);
      });
    });

    describe('findMappingById', () => {
      it('should return mapping by ID', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const createResult = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });
        if (!createResult.success) return;

        const found = repo.findMappingById(createResult.data.id);

        expect(found).not.toBeNull();
        expect(found!.deviceAddress).toBe('DB1,REAL0');
        expect(found!.nodeId).toBe(nodeId);
      });

      it('should return null for non-existent ID', () => {
        const found = repo.findMappingById('non-existent-id');
        expect(found).toBeNull();
      });
    });

    describe('updateMapping', () => {
      it('should update device address', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const createResult = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });
        if (!createResult.success) return;

        const updateResult = repo.updateMapping(createResult.data.id, {
          deviceAddress: 'DB1,REAL4',
        });

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.deviceAddress).toBe('DB1,REAL4');
          expect(updateResult.data.nodeId).toBe(nodeId);
        }
      });

      it('should return NOT_FOUND for non-existent mapping', () => {
        const result = repo.updateMapping('non-existent', { deviceAddress: 'DB1,REAL0' });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
        }
      });

      it('should reject update that causes duplicate device address', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' });
        const second = repo.createMapping({ connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL4' });
        if (!second.success) return;

        const result = repo.updateMapping(second.data.id, { deviceAddress: 'DB1,REAL0' });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DUPLICATE_ERROR');
        }
      });
    });

    describe('deleteMapping', () => {
      it('should delete an existing mapping', () => {
        const nodeId = createTestNode();
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const createResult = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
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
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const first = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL0',
        });
        if (!first.success) return;
        repo.deleteMapping(first.data.id);

        const second = repo.createMapping({
          connectionId: connResult.data.id,
          nodeId,
          deviceAddress: 'DB1,REAL4',
        });

        expect(second.success).toBe(true);
      });
    });

    describe('createMappingsBulk', () => {
      it('should create all mappings when all are valid', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const requests: CreateMappingRequest[] = [
          { connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' },
          { connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL4' },
        ];

        const result = repo.createMappingsBulk(requests);

        expect(result.created).toHaveLength(2);
        expect(result.errors).toHaveLength(0);
      });

      it('should report per-item errors for mixed success/failure', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const requests: CreateMappingRequest[] = [
          { connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' },
          { connectionId: 'non-existent', nodeId: nodeId2, deviceAddress: 'DB1,REAL4' },
          { connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL8' },
        ];

        const result = repo.createMappingsBulk(requests);

        expect(result.created).toHaveLength(2);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].index).toBe(1);
        expect(result.errors[0].error.code).toBe('NOT_FOUND');
      });

      it('should detect duplicate within the same bulk request', () => {
        const nodeId1 = createTestNode('node-1', 'Sensor1');
        const nodeId2 = createTestNode('node-2', 'Sensor2');
        const connResult = repo.createConnection(s7ConnectionRequest('PLC1'));
        if (!connResult.success) return;

        const requests: CreateMappingRequest[] = [
          { connectionId: connResult.data.id, nodeId: nodeId1, deviceAddress: 'DB1,REAL0' },
          { connectionId: connResult.data.id, nodeId: nodeId2, deviceAddress: 'DB1,REAL0' }, // duplicate address
        ];

        const result = repo.createMappingsBulk(requests);

        expect(result.created).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].index).toBe(1);
        expect(result.errors[0].error.code).toBe('DUPLICATE_ERROR');
      });

      it('should return empty results for empty input', () => {
        const result = repo.createMappingsBulk([]);

        expect(result.created).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });
    });
  });
});

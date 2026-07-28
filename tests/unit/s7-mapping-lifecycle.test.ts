import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../src/db/database.js';
import { S7Repository } from '../../src/db/repositories/s7-repository.js';
import { S7Connector } from '../../src/connectors/s7/index.js';
import type { ConnectionConfig, Mapping } from '../../src/connectors/types.js';
import { ConfigGenerator } from '../../src/config-generator/index.js';

describe('S7 Mapping Lifecycle', () => {
  let db: Database;
  let s7Repo: S7Repository;

  beforeEach(() => {
    db = new Database(':memory:');
    s7Repo = new S7Repository(db);

    // Seed namespace, object node, and variable node
    const conn = db.getConnection();
    conn.prepare("INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')").run();
    conn.prepare("INSERT INTO object_nodes (id, namespace_id, name) VALUES ('obj1', 'ns1', 'Devices')").run();
    conn.prepare("INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', 'obj1', 'Temperature', 'Double')").run();
    conn.prepare("INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n2', 'ns1', 'obj1', 'Pressure', 'Float')").run();
    conn.prepare("INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n3', 'ns1', NULL, 'RootNode', 'Boolean')").run();
  });

  afterEach(() => {
    db.close();
  });

  describe('S7 Connection and Mapping CRUD', () => {
    it('should create a connection and mapping', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      expect(connResult.success).toBe(true);
      if (!connResult.success) return;

      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id,
        nodeId: 'n1',
        plcAddress: 'DB1,REAL0',
      });
      expect(mapResult.success).toBe(true);
      if (!mapResult.success) return;
      expect(mapResult.data.plcAddress).toBe('DB1,REAL0');
      expect(mapResult.data.nodeId).toBe('n1');
    });

    it('should update a mapping PLC address', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const updateResult = s7Repo.updateMapping(mapResult.data.id, { plcAddress: 'DB1,REAL4' });
      expect(updateResult.success).toBe(true);
      if (!updateResult.success) return;
      expect(updateResult.data.plcAddress).toBe('DB1,REAL4');
      expect(updateResult.data.nodeId).toBe('n1');
    });

    it('should update a mapping node ID', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const updateResult = s7Repo.updateMapping(mapResult.data.id, { nodeId: 'n2' });
      expect(updateResult.success).toBe(true);
      if (!updateResult.success) return;
      expect(updateResult.data.nodeId).toBe('n2');
    });

    it('should reject update to non-existent node', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const updateResult = s7Repo.updateMapping(mapResult.data.id, { nodeId: 'nonexistent' });
      expect(updateResult.success).toBe(false);
      if (updateResult.success) return;
      expect(updateResult.error.code).toBe('NOT_FOUND');
    });

    it('should reject duplicate PLC address on update', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      s7Repo.createMapping({ connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0' });
      const map2 = s7Repo.createMapping({ connectionId: connResult.data.id, nodeId: 'n2', plcAddress: 'DB1,REAL4' });
      if (!map2.success) return;

      const updateResult = s7Repo.updateMapping(map2.data.id, { plcAddress: 'DB1,REAL0' });
      expect(updateResult.success).toBe(false);
      if (updateResult.success) return;
      expect(updateResult.error.code).toBe('DUPLICATE_ERROR');
    });

    it('should delete a mapping', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      const deleteResult = s7Repo.deleteMapping(mapResult.data.id);
      expect(deleteResult.success).toBe(true);

      const all = s7Repo.findAllMappings();
      expect(all).toHaveLength(0);
    });
  });

  describe('S7 Connector notification on mapping changes', () => {
    /** Helper: convert S7ConnectionConfig to the generic ConnectionConfig shape. */
    function toConnectionConfig(s7Conn: { id: string; name: string; host: string; rack: number; slot: number; pollingIntervalMs: number; reconnectIntervalMs: number; enabled: boolean; createdAt: string }): ConnectionConfig {
      return {
        id: s7Conn.id,
        type: 's7',
        name: s7Conn.name,
        params: { host: s7Conn.host, rack: s7Conn.rack, slot: s7Conn.slot },
        pollingIntervalMs: s7Conn.pollingIntervalMs,
        reconnectIntervalMs: s7Conn.reconnectIntervalMs,
        enabled: s7Conn.enabled,
        createdAt: s7Conn.createdAt,
      };
    }

    /** Helper: convert S7Mapping to the generic Mapping shape. */
    function toMapping(s7Map: { id: string; connectionId: string; nodeId: string; plcAddress: string; description?: string; createdAt: string }): Mapping {
      return {
        id: s7Map.id,
        connectionId: s7Map.connectionId,
        nodeId: s7Map.nodeId,
        deviceAddress: s7Map.plcAddress,
        description: s7Map.description,
        createdAt: s7Map.createdAt,
      };
    }

    it('should add mapping to connector when created', () => {
      const connector = new S7Connector();
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      // Add the connection to the connector (translated to generic shape)
      connector.addConnection(toConnectionConfig(connResult.data));

      // Create a mapping and notify the connector
      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      // This should not throw
      expect(() => connector.addMapping(toMapping(mapResult.data))).not.toThrow();
    });

    it('should remove mapping from connector when deleted', () => {
      const connector = new S7Connector();
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      connector.addConnection(toConnectionConfig(connResult.data));

      const mapResult = s7Repo.createMapping({
        connectionId: connResult.data.id, nodeId: 'n1', plcAddress: 'DB1,REAL0',
      });
      if (!mapResult.success) return;

      connector.addMapping(toMapping(mapResult.data));

      // Remove mapping
      expect(() => connector.removeMapping(mapResult.data.id)).not.toThrow();
    });
  });

  describe('Node ID resolution (UUID → OPC UA node ID)', () => {
    it('should resolve node UUID to OPC UA node ID via config generator', () => {
      const generator = new ConfigGenerator(db);
      const config = generator.generate();

      // Find the Temperature node in the config
      const ns = config.namespaces[0];
      const tempNode = ns.nodes.find((n) => n.name === 'Temperature');
      expect(tempNode).toBeDefined();
      expect(tempNode!.nodeId).toBe('ns=2;s=TestNS.Devices.Temperature');
      expect(tempNode!.parentPath).toBe('TestNS.Devices');
    });

    it('should produce correct OPC UA node ID for root-level nodes', () => {
      const generator = new ConfigGenerator(db);
      const config = generator.generate();

      const ns = config.namespaces[0];
      const rootNode = ns.nodes.find((n) => n.name === 'RootNode');
      expect(rootNode).toBeDefined();
      expect(rootNode!.nodeId).toBe('ns=2;s=TestNS.RootNode');
      expect(rootNode!.parentPath).toBe('TestNS');
    });

    it('should build UUID-to-nodeId map correctly', () => {
      const generator = new ConfigGenerator(db);
      const config = generator.generate();
      const conn = db.getConnection();

      const map = new Map<string, string>();
      for (const ns of config.namespaces) {
        for (const node of ns.nodes) {
          const row = conn.prepare(
            `SELECT n.id FROM nodes n
             JOIN namespaces nsp ON n.namespace_id = nsp.id
             WHERE n.name = ? AND nsp.name = ?`
          ).get(node.name, ns.name) as { id: string } | undefined;
          if (row) {
            map.set(row.id, node.nodeId);
          }
        }
      }

      expect(map.get('n1')).toBe('ns=2;s=TestNS.Devices.Temperature');
      expect(map.get('n2')).toBe('ns=2;s=TestNS.Devices.Pressure');
      expect(map.get('n3')).toBe('ns=2;s=TestNS.RootNode');
    });
  });

  describe('S7 Connection update', () => {
    it('should update connection fields', () => {
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      const updateResult = s7Repo.updateConnection(connResult.data.id, {
        name: 'PLC1-Updated',
        host: '10.0.0.2',
        pollingIntervalMs: 500,
      });
      expect(updateResult.success).toBe(true);
      if (!updateResult.success) return;
      expect(updateResult.data.name).toBe('PLC1-Updated');
      expect(updateResult.data.host).toBe('10.0.0.2');
      expect(updateResult.data.pollingIntervalMs).toBe(500);
      // Unchanged fields
      expect(updateResult.data.rack).toBe(0);
      expect(updateResult.data.slot).toBe(1);
    });

    it('should return NOT_FOUND for non-existent connection', () => {
      const result = s7Repo.updateConnection('nonexistent', { name: 'X' });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('should reconnect connector when connection is updated', () => {
      const connector = new S7Connector();
      const connResult = s7Repo.createConnection({
        name: 'PLC1', host: '10.0.0.1', rack: 0, slot: 1,
      });
      if (!connResult.success) return;

      const toConnConfig = (c: typeof connResult.data): ConnectionConfig => ({
        id: c.id,
        type: 's7',
        name: c.name,
        params: { host: c.host, rack: c.rack, slot: c.slot },
        pollingIntervalMs: c.pollingIntervalMs,
        reconnectIntervalMs: c.reconnectIntervalMs,
        enabled: c.enabled,
        createdAt: c.createdAt,
      });

      connector.addConnection(toConnConfig(connResult.data));

      const updatedConfig = toConnConfig({ ...connResult.data, host: '10.0.0.2', name: 'PLC1-Updated' });
      // updateConnection should not throw
      expect(() => connector.updateConnection(updatedConfig)).not.toThrow();

      // Verify the status reflects the updated connection
      const statuses = connector.getStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].connectionId).toBe(connResult.data.id);
    });
  });
});

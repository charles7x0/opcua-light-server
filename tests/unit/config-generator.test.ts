import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from '../../src/db/database.js';
import { ConfigGenerator } from '../../src/config-generator/index.js';

describe('ConfigGenerator', () => {
  let db: Database;
  let generator: ConfigGenerator;

  beforeEach(() => {
    db = new Database(':memory:');
    generator = new ConfigGenerator(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('generate', () => {
    it('should produce a valid config with version 1 and generatedAt timestamp', () => {
      const config = generator.generate();

      expect(config.version).toBe(1);
      expect(config.generatedAt).toBeDefined();
      // Verify it's a valid ISO timestamp
      expect(new Date(config.generatedAt).toISOString()).toBe(config.generatedAt);
    });

    it('should include default security config when no security is configured', () => {
      const config = generator.generate();

      expect(config.security.mode).toBe('None');
      expect(config.security.certificatePath).toBeUndefined();
      expect(config.security.privateKeyPath).toBeUndefined();
    });

    it('should include security config with certificate and key paths', () => {
      const conn = db.getConnection();
      conn.prepare(
        "UPDATE security_config SET mode = 'SignAndEncrypt', certificate_path = '/certs/server.der', private_key_path = '/certs/server.key' WHERE id = 1"
      ).run();

      const config = generator.generate();

      expect(config.security.mode).toBe('SignAndEncrypt');
      expect(config.security.certificatePath).toBe('/certs/server.der');
      expect(config.security.privateKeyPath).toBe('/certs/server.key');
    });

    it('should return empty namespaces array when no namespaces exist', () => {
      const config = generator.generate();

      expect(config.namespaces).toEqual([]);
    });

    it('should include namespaces with name and uri', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'PlantFloor', 'urn:opcua-light:PlantFloor')"
      ).run();

      const config = generator.generate();

      expect(config.namespaces).toHaveLength(1);
      expect(config.namespaces[0].name).toBe('PlantFloor');
      expect(config.namespaces[0].uri).toBe('urn:opcua-light:PlantFloor');
    });

    it('should build object node tree for a namespace', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'PlantFloor', 'urn:opcua-light:PlantFloor')"
      ).run();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f1', 'ns1', NULL, 'Devices')"
      ).run();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f2', 'ns1', 'f1', 'PLC1')"
      ).run();

      const config = generator.generate();

      expect(config.namespaces[0].objectNodes).toHaveLength(1);
      expect(config.namespaces[0].objectNodes[0].name).toBe('Devices');
      expect(config.namespaces[0].objectNodes[0].path).toBe('PlantFloor.Devices');
      expect(config.namespaces[0].objectNodes[0].children).toHaveLength(1);
      expect(config.namespaces[0].objectNodes[0].children[0].name).toBe('PLC1');
      expect(config.namespaces[0].objectNodes[0].children[0].path).toBe('PlantFloor.Devices.PLC1');
    });

    it('should build nodes with correct nodeId format', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'PlantFloor', 'urn:opcua-light:PlantFloor')"
      ).run();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f1', 'ns1', NULL, 'Temperatures')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value) VALUES ('n1', 'ns1', 'f1', 'Sensor1', 'Double', '0.0')"
      ).run();

      const config = generator.generate();

      expect(config.namespaces[0].nodes).toHaveLength(1);
      const node = config.namespaces[0].nodes[0];
      expect(node.name).toBe('Sensor1');
      expect(node.nodeId).toBe('ns=2;s=PlantFloor.Temperatures.Sensor1');
      expect(node.dataType).toBe('Double');
      expect(node.parentPath).toBe('PlantFloor.Temperatures');
      expect(node.initialValue).toBe(0.0);
    });

    it('should use namespace name as parentPath for nodes without an object node', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'PlantFloor', 'urn:opcua-light:PlantFloor')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', NULL, 'RootNode', 'Boolean')"
      ).run();

      const config = generator.generate();

      const node = config.namespaces[0].nodes[0];
      expect(node.parentPath).toBe('PlantFloor');
      expect(node.nodeId).toBe('ns=2;s=PlantFloor.RootNode');
    });

    it('should assign namespace indices starting at 2', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'Alpha', 'urn:alpha')"
      ).run();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns2', 'Beta', 'urn:beta')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', NULL, 'Node1', 'Int32')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n2', 'ns2', NULL, 'Node2', 'String')"
      ).run();

      const config = generator.generate();

      // Namespaces are ordered by name: Alpha (ns=2), Beta (ns=3)
      expect(config.namespaces[0].name).toBe('Alpha');
      expect(config.namespaces[0].nodes[0].nodeId).toBe('ns=2;s=Alpha.Node1');
      expect(config.namespaces[1].name).toBe('Beta');
      expect(config.namespaces[1].nodes[0].nodeId).toBe('ns=3;s=Beta.Node2');
    });

    it('should include S7 mapping info when available', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'PlantFloor', 'urn:plant')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', NULL, 'Temp', 'Double')"
      ).run();
      conn.prepare(
        "INSERT INTO s7_connections (id, name, host, rack, slot) VALUES ('c1', 'PLC1', '192.168.1.10', 0, 1)"
      ).run();
      conn.prepare(
        "INSERT INTO s7_mappings (id, connection_id, node_id, plc_address) VALUES ('m1', 'c1', 'n1', 'DB1,REAL0')"
      ).run();

      const config = generator.generate();

      const node = config.namespaces[0].nodes[0];
      expect(node.s7Mapping).toBeDefined();
      expect(node.s7Mapping!.connectionHost).toBe('192.168.1.10');
      expect(node.s7Mapping!.plcAddress).toBe('DB1,REAL0');
    });

    it('should not include s7Mapping when node has no mapping', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'PlantFloor', 'urn:plant')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', NULL, 'Temp', 'Double')"
      ).run();

      const config = generator.generate();

      const node = config.namespaces[0].nodes[0];
      expect(node.s7Mapping).toBeUndefined();
    });

    it('should handle deeply nested object node structures', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'Plant', 'urn:plant')"
      ).run();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f1', 'ns1', NULL, 'Level1')"
      ).run();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f2', 'ns1', 'f1', 'Level2')"
      ).run();
      conn.prepare(
        "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f3', 'ns1', 'f2', 'Level3')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', 'f3', 'DeepNode', 'Float')"
      ).run();

      const config = generator.generate();

      const node = config.namespaces[0].nodes[0];
      expect(node.parentPath).toBe('Plant.Level1.Level2.Level3');
      expect(node.nodeId).toBe('ns=2;s=Plant.Level1.Level2.Level3.DeepNode');
    });

    it('should handle nodes with JSON initial values', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'Test', 'urn:test')"
      ).run();
      conn.prepare(
        `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value) VALUES ('n1', 'ns1', NULL, 'BoolNode', 'Boolean', 'true')`
      ).run();
      conn.prepare(
        `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value) VALUES ('n2', 'ns1', NULL, 'StringNode', 'String', '"hello"')`
      ).run();

      const config = generator.generate();

      const boolNode = config.namespaces[0].nodes.find(n => n.name === 'BoolNode');
      const stringNode = config.namespaces[0].nodes.find(n => n.name === 'StringNode');

      expect(boolNode!.initialValue).toBe(true);
      expect(stringNode!.initialValue).toBe('hello');
    });

    it('should not include initialValue when it is null', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'Test', 'urn:test')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', NULL, 'NoValue', 'Int32')"
      ).run();

      const config = generator.generate();

      const node = config.namespaces[0].nodes[0];
      expect(node.initialValue).toBeUndefined();
      expect('initialValue' in node).toBe(false);
    });
  });

  describe('writeToFile', () => {
    it('should write valid JSON to the specified file path', () => {
      const conn = db.getConnection();
      conn.prepare(
        "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'Test', 'urn:test')"
      ).run();
      conn.prepare(
        "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value) VALUES ('n1', 'ns1', NULL, 'Sensor', 'Double', '42.5')"
      ).run();

      const filePath = join(tmpdir(), `opcua-config-test-${Date.now()}.json`);

      try {
        generator.writeToFile(filePath);

        expect(existsSync(filePath)).toBe(true);

        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);

        expect(parsed.version).toBe(1);
        expect(parsed.namespaces).toHaveLength(1);
        expect(parsed.namespaces[0].nodes[0].name).toBe('Sensor');
        expect(parsed.namespaces[0].nodes[0].initialValue).toBe(42.5);
      } finally {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      }
    });

    it('should produce pretty-printed JSON', () => {
      const filePath = join(tmpdir(), `opcua-config-test-${Date.now()}.json`);

      try {
        generator.writeToFile(filePath);

        const content = readFileSync(filePath, 'utf-8');
        // Pretty-printed JSON has newlines and indentation
        expect(content).toContain('\n');
        expect(content).toContain('  ');
      } finally {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      }
    });
  });
});

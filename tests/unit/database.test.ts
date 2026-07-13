import { describe, it, expect, afterEach } from 'vitest';
import { Database, DatabaseUnavailableError } from '../../src/db/database.js';

describe('Database', () => {
  let db: Database;

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('initialization', () => {
    it('should initialize with an in-memory database', () => {
      db = new Database(':memory:');
      expect(db.isAccessible()).toBe(true);
    });

    it('should apply schema on first run', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      // Verify all tables exist
      const tables = conn
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('namespaces');
      expect(tableNames).toContain('object_nodes');
      expect(tableNames).toContain('nodes');
      expect(tableNames).toContain('security_config');
      expect(tableNames).toContain('s7_connections');
      expect(tableNames).toContain('s7_mappings');
    });

    it('should set schema version to 4', () => {
      db = new Database(':memory:');
      expect(db.getSchemaVersion()).toBe(4);
    });

    it('should insert default security config row', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();
      const row = conn
        .prepare('SELECT * FROM security_config WHERE id = 1')
        .get() as { id: number; mode: string } | undefined;

      expect(row).toBeDefined();
      expect(row!.mode).toBe('None');
    });

    it('should enable WAL journal mode', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();
      const result = conn.pragma('journal_mode') as { journal_mode: string }[];
      // In-memory databases may report 'memory' for journal mode
      expect(['wal', 'memory']).toContain(result[0].journal_mode);
    });

    it('should enable foreign keys', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();
      const result = conn.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(result[0].foreign_keys).toBe(1);
    });
  });

  describe('schema validation', () => {
    it('should enforce foreign key constraints on object_nodes', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f1', 'nonexistent', 'test')"
          )
          .run();
      }).toThrow();
    });

    it('should enforce unique namespace names', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO namespaces (id, name, uri) VALUES ('ns2', 'TestNS', 'urn:test:ns2')"
          )
          .run();
      }).toThrow();
    });

    it('should enforce unique namespace URIs', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'NS1', 'urn:test:same')"
        )
        .run();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO namespaces (id, name, uri) VALUES ('ns2', 'NS2', 'urn:test:same')"
          )
          .run();
      }).toThrow();
    });

    it('should enforce unique node names within a namespace', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', 'ns1', 'Sensor1', 'Double')"
        )
        .run();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n2', 'ns1', 'Sensor1', 'Int32')"
          )
          .run();
      }).toThrow();
    });

    it('should enforce unique object node names within same parent', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f1', 'ns1', NULL, 'Object1')"
        )
        .run();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name) VALUES ('f2', 'ns1', NULL, 'Object1')"
          )
          .run();
      }).toThrow();
    });

    it('should cascade delete object nodes when namespace is deleted', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f1', 'ns1', 'Object1')"
        )
        .run();

      conn.prepare("DELETE FROM namespaces WHERE id = 'ns1'").run();

      const objectNodes = conn.prepare('SELECT * FROM object_nodes').all();
      expect(objectNodes).toHaveLength(0);
    });

    it('should cascade delete nodes when namespace is deleted', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', 'ns1', 'Sensor1', 'Double')"
        )
        .run();

      conn.prepare("DELETE FROM namespaces WHERE id = 'ns1'").run();

      const nodes = conn.prepare('SELECT * FROM nodes').all();
      expect(nodes).toHaveLength(0);
    });

    it('should set object_node_id to NULL when object node is deleted (ON DELETE SET NULL)', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO object_nodes (id, namespace_id, name) VALUES ('f1', 'ns1', 'Object1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type) VALUES ('n1', 'ns1', 'f1', 'Sensor1', 'Double')"
        )
        .run();

      conn.prepare("DELETE FROM object_nodes WHERE id = 'f1'").run();

      const node = conn.prepare("SELECT * FROM nodes WHERE id = 'n1'").get() as {
        object_node_id: string | null;
      };
      expect(node.object_node_id).toBeNull();
    });

    it('should enforce security_config single row constraint', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO security_config (id, mode) VALUES (2, 'Sign')"
          )
          .run();
      }).toThrow();
    });

    it('should cascade delete s7_mappings when s7_connection is deleted', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', 'ns1', 'Sensor1', 'Double')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO s7_connections (id, name, host) VALUES ('c1', 'PLC1', '192.168.1.1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO s7_mappings (id, connection_id, node_id, plc_address) VALUES ('m1', 'c1', 'n1', 'DB1,REAL0')"
        )
        .run();

      conn.prepare("DELETE FROM s7_connections WHERE id = 'c1'").run();

      const mappings = conn.prepare('SELECT * FROM s7_mappings').all();
      expect(mappings).toHaveLength(0);
    });

    it('should enforce unique s7_mapping per node', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();

      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO nodes (id, namespace_id, name, data_type) VALUES ('n1', 'ns1', 'Sensor1', 'Double')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO s7_connections (id, name, host) VALUES ('c1', 'PLC1', '192.168.1.1')"
        )
        .run();
      conn
        .prepare(
          "INSERT INTO s7_mappings (id, connection_id, node_id, plc_address) VALUES ('m1', 'c1', 'n1', 'DB1,REAL0')"
        )
        .run();

      expect(() => {
        conn
          .prepare(
            "INSERT INTO s7_mappings (id, connection_id, node_id, plc_address) VALUES ('m2', 'c1', 'n1', 'DB1,REAL4')"
          )
          .run();
      }).toThrow();
    });
  });

  describe('isAccessible', () => {
    it('should return true when database is open', () => {
      db = new Database(':memory:');
      expect(db.isAccessible()).toBe(true);
    });

    it('should return false after database is closed', () => {
      db = new Database(':memory:');
      db.close();
      expect(db.isAccessible()).toBe(false);
    });
  });

  describe('getConnection', () => {
    it('should return the database connection', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();
      expect(conn).toBeDefined();
    });

    it('should throw DatabaseUnavailableError when closed', () => {
      db = new Database(':memory:');
      db.close();
      expect(() => db.getConnection()).toThrow(DatabaseUnavailableError);
    });
  });

  describe('cache operations', () => {
    it('should store and retrieve cached data', () => {
      db = new Database(':memory:');
      const testData = [{ id: '1', name: 'test' }];
      db.updateCache('namespaces', testData);

      const cached = db.getFromCache('namespaces');
      expect(cached).toEqual(testData);
    });

    it('should return null for non-existent cache keys', () => {
      db = new Database(':memory:');
      expect(db.getFromCache('nonexistent')).toBeNull();
    });

    it('should clear all cached data', () => {
      db = new Database(':memory:');
      db.updateCache('key1', [{ a: 1 }]);
      db.updateCache('key2', [{ b: 2 }]);

      db.clearCache();

      expect(db.getFromCache('key1')).toBeNull();
      expect(db.getFromCache('key2')).toBeNull();
    });
  });

  describe('readWithCache', () => {
    it('should execute query and cache result when accessible', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();
      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();

      const result = db.readWithCache('namespaces', (dbConn) =>
        dbConn.prepare('SELECT * FROM namespaces').all()
      );

      expect(result).toHaveLength(1);
      expect((result[0] as { name: string }).name).toBe('TestNS');
    });

    it('should return cached data when database becomes inaccessible', () => {
      db = new Database(':memory:');
      const conn = db.getConnection();
      conn
        .prepare(
          "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
        )
        .run();

      // First read populates cache
      db.readWithCache('namespaces', (dbConn) =>
        dbConn.prepare('SELECT * FROM namespaces').all()
      );

      // Close database to simulate inaccessibility
      db.close();

      // Create a new instance that's closed to test cache
      // We need to test the cache fallback differently since close() nulls the db
      // Let's test by pre-populating cache then checking
      db = new Database(':memory:');
      db.updateCache('test-key', [{ id: '1', name: 'cached' }]);
      db.close();

      // After close, readWithCache should use the cache
      // But since db is null, isAccessible returns false
      const result = db.readWithCache('test-key', () => {
        throw new Error('Should not be called');
      });
      expect(result).toEqual([{ id: '1', name: 'cached' }]);
    });

    it('should throw when inaccessible and no cache available', () => {
      db = new Database(':memory:');
      db.close();

      expect(() =>
        db.readWithCache('no-cache', () => {
          throw new Error('Should not be called');
        })
      ).toThrow(DatabaseUnavailableError);
    });
  });

  describe('write', () => {
    it('should execute write operations when accessible', () => {
      db = new Database(':memory:');

      const result = db.write((conn) =>
        conn
          .prepare(
            "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
          )
          .run()
      );

      expect(result.changes).toBe(1);
    });

    it('should throw DatabaseUnavailableError when inaccessible', () => {
      db = new Database(':memory:');
      db.close();

      expect(() =>
        db.write((conn) =>
          conn
            .prepare(
              "INSERT INTO namespaces (id, name, uri) VALUES ('ns1', 'TestNS', 'urn:test:ns1')"
            )
            .run()
        )
      ).toThrow(DatabaseUnavailableError);
    });
  });

  describe('close', () => {
    it('should close the database connection', () => {
      db = new Database(':memory:');
      db.close();
      expect(db.isAccessible()).toBe(false);
    });

    it('should be safe to call close multiple times', () => {
      db = new Database(':memory:');
      db.close();
      expect(() => db.close()).not.toThrow();
    });
  });
});

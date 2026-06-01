import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database.js';
import type { S7ConnectionConfig, S7Mapping } from '../../types/index.js';
import type { CreateS7ConnectionRequest, CreateS7MappingRequest } from '../../types/api.js';

/** Result type for repository operations that can fail with a domain error. */
export type S7Result<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: { field: string; message: string }[] } };

/** Row shape returned from the s7_connections table. */
interface S7ConnectionRow {
  id: string;
  name: string;
  host: string;
  rack: number;
  slot: number;
  polling_interval_ms: number;
  reconnect_interval_ms: number;
  enabled: number;
  created_at: string;
}

/** Row shape returned from the s7_mappings table. */
interface S7MappingRow {
  id: string;
  connection_id: string;
  node_id: string;
  plc_address: string;
  created_at: string;
}

/**
 * Maps a database row to an S7ConnectionConfig domain object.
 */
function rowToConnection(row: S7ConnectionRow): S7ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    rack: row.rack,
    slot: row.slot,
    pollingIntervalMs: row.polling_interval_ms,
    reconnectIntervalMs: row.reconnect_interval_ms,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

/**
 * Maps a database row to an S7Mapping domain object.
 */
function rowToMapping(row: S7MappingRow): S7Mapping {
  return {
    id: row.id,
    connectionId: row.connection_id,
    nodeId: row.node_id,
    plcAddress: row.plc_address,
    createdAt: row.created_at,
  };
}

/**
 * Repository for managing S7 PLC connections and variable-to-node mappings.
 * Provides CRUD operations with uniqueness constraint enforcement.
 */
export class S7Repository {
  constructor(private database: Database) {}

  // ─── S7 Connection CRUD ───────────────────────────────────────────────────────

  /**
   * Create a new S7 connection.
   */
  createConnection(request: CreateS7ConnectionRequest): S7Result<S7ConnectionConfig> {
    const id = uuidv4();

    const connection = this.database.write((db) => {
      db.prepare(
        `INSERT INTO s7_connections (id, name, host, rack, slot, polling_interval_ms, reconnect_interval_ms, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        id,
        request.name,
        request.host,
        request.rack,
        request.slot,
        request.pollingIntervalMs ?? 1000,
        request.reconnectIntervalMs ?? 5000,
        request.enabled !== undefined ? (request.enabled ? 1 : 0) : 1
      );

      return db.prepare('SELECT * FROM s7_connections WHERE id = ?').get(id) as S7ConnectionRow;
    });

    return { success: true, data: rowToConnection(connection) };
  }

  /**
   * Retrieve all S7 connections.
   */
  findAllConnections(): S7ConnectionConfig[] {
    return this.database.readWithCache('s7_connections', (db) => {
      const rows = db.prepare(
        'SELECT * FROM s7_connections ORDER BY name'
      ).all() as S7ConnectionRow[];

      return rows.map(rowToConnection);
    });
  }

  /**
   * Find an S7 connection by its ID.
   * Returns null if not found.
   */
  findConnectionById(id: string): S7ConnectionConfig | null {
    return this.database.readWithCache(`s7_connection:${id}`, (db) => {
      const row = db.prepare(
        'SELECT * FROM s7_connections WHERE id = ?'
      ).get(id) as S7ConnectionRow | undefined;

      if (!row) return [];
      return [rowToConnection(row)];
    })[0] ?? null;
  }

  /**
   * Delete an S7 connection by ID.
   * Cascade deletion of associated mappings is handled by SQLite foreign keys.
   */
  deleteConnection(id: string): S7Result<void> {
    const existing = this.findConnectionById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `S7 connection with id "${id}" not found`,
        },
      };
    }

    this.database.write((db) => {
      db.prepare('DELETE FROM s7_connections WHERE id = ?').run(id);
    });

    return { success: true, data: undefined };
  }

  /**
   * Update an existing S7 connection.
   * Only provided fields are updated.
   */
  updateConnection(id: string, request: {
    name?: string;
    host?: string;
    rack?: number;
    slot?: number;
    pollingIntervalMs?: number;
    reconnectIntervalMs?: number;
    enabled?: boolean;
  }): S7Result<S7ConnectionConfig> {
    const existing = this.findConnectionById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `S7 connection with id "${id}" not found`,
        },
      };
    }

    const updated = this.database.write((db) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (request.name !== undefined) { updates.push('name = ?'); values.push(request.name); }
      if (request.host !== undefined) { updates.push('host = ?'); values.push(request.host); }
      if (request.rack !== undefined) { updates.push('rack = ?'); values.push(request.rack); }
      if (request.slot !== undefined) { updates.push('slot = ?'); values.push(request.slot); }
      if (request.pollingIntervalMs !== undefined) { updates.push('polling_interval_ms = ?'); values.push(request.pollingIntervalMs); }
      if (request.reconnectIntervalMs !== undefined) { updates.push('reconnect_interval_ms = ?'); values.push(request.reconnectIntervalMs); }
      if (request.enabled !== undefined) { updates.push('enabled = ?'); values.push(request.enabled ? 1 : 0); }

      if (updates.length === 0) {
        return db.prepare('SELECT * FROM s7_connections WHERE id = ?').get(id) as S7ConnectionRow;
      }

      values.push(id);
      db.prepare(`UPDATE s7_connections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return db.prepare('SELECT * FROM s7_connections WHERE id = ?').get(id) as S7ConnectionRow;
    });

    return { success: true, data: rowToConnection(updated) };
  }

  // ─── S7 Mapping CRUD ──────────────────────────────────────────────────────────

  /**
   * Create a new S7 mapping.
   * Enforces:
   * - One mapping per node (UNIQUE(node_id))
   * - Unique PLC address per connection (UNIQUE(connection_id, plc_address))
   */
  createMapping(request: CreateS7MappingRequest): S7Result<S7Mapping> {
    // Validate that the connection exists
    const connection = this.findConnectionById(request.connectionId);
    if (!connection) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `S7 connection with id "${request.connectionId}" not found`,
          details: [{ field: 'connectionId', message: `Connection "${request.connectionId}" does not exist` }],
        },
      };
    }

    // Validate that the node exists
    const nodeExists = this.nodeExists(request.nodeId);
    if (!nodeExists) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Node with id "${request.nodeId}" not found`,
          details: [{ field: 'nodeId', message: `Node "${request.nodeId}" does not exist` }],
        },
      };
    }

    // Check unique constraint: one mapping per node
    const existingNodeMapping = this.findMappingByNodeId(request.nodeId);
    if (existingNodeMapping) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ERROR',
          message: `Node "${request.nodeId}" already has an S7 mapping`,
          details: [{ field: 'nodeId', message: `Node "${request.nodeId}" is already mapped to a PLC address` }],
        },
      };
    }

    // Check unique constraint: unique PLC address per connection
    const existingAddressMapping = this.findMappingByConnectionAndAddress(
      request.connectionId,
      request.plcAddress
    );
    if (existingAddressMapping) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ERROR',
          message: `PLC address "${request.plcAddress}" is already mapped in connection "${request.connectionId}"`,
          details: [{ field: 'plcAddress', message: `PLC address "${request.plcAddress}" is already in use for this connection` }],
        },
      };
    }

    const id = uuidv4();

    const mapping = this.database.write((db) => {
      db.prepare(
        `INSERT INTO s7_mappings (id, connection_id, node_id, plc_address, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ).run(id, request.connectionId, request.nodeId, request.plcAddress);

      return db.prepare('SELECT * FROM s7_mappings WHERE id = ?').get(id) as S7MappingRow;
    });

    return { success: true, data: rowToMapping(mapping) };
  }

  /**
   * Retrieve all S7 mappings, optionally filtered by connection ID.
   */
  findAllMappings(connectionId?: string): S7Mapping[] {
    const cacheKey = connectionId ? `s7_mappings:connection:${connectionId}` : 's7_mappings';

    return this.database.readWithCache(cacheKey, (db) => {
      if (connectionId) {
        const rows = db.prepare(
          'SELECT * FROM s7_mappings WHERE connection_id = ? ORDER BY plc_address'
        ).all(connectionId) as S7MappingRow[];
        return rows.map(rowToMapping);
      }

      const rows = db.prepare(
        'SELECT * FROM s7_mappings ORDER BY connection_id, plc_address'
      ).all() as S7MappingRow[];
      return rows.map(rowToMapping);
    });
  }

  /**
   * Find an S7 mapping by its ID.
   * Returns null if not found.
   */
  findMappingById(id: string): S7Mapping | null {
    return this.database.readWithCache(`s7_mapping:${id}`, (db) => {
      const row = db.prepare(
        'SELECT * FROM s7_mappings WHERE id = ?'
      ).get(id) as S7MappingRow | undefined;

      if (!row) return [];
      return [rowToMapping(row)];
    })[0] ?? null;
  }

  /**
   * Delete an S7 mapping by ID.
   */
  deleteMapping(id: string): S7Result<void> {
    const existing = this.findMappingById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `S7 mapping with id "${id}" not found`,
        },
      };
    }

    this.database.write((db) => {
      db.prepare('DELETE FROM s7_mappings WHERE id = ?').run(id);
    });

    return { success: true, data: undefined };
  }

  /**
   * Update an existing S7 mapping.
   * Allows changing the PLC address or node ID.
   */
  updateMapping(id: string, request: { plcAddress?: string; nodeId?: string }): S7Result<S7Mapping> {
    const existing = this.findMappingById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `S7 mapping with id "${id}" not found`,
        },
      };
    }

    // Validate new node if provided
    if (request.nodeId && request.nodeId !== existing.nodeId) {
      if (!this.nodeExists(request.nodeId)) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Node with id "${request.nodeId}" not found`,
            details: [{ field: 'nodeId', message: `Node "${request.nodeId}" does not exist` }],
          },
        };
      }
      // Check uniqueness: one mapping per node
      const existingNodeMapping = this.findMappingByNodeId(request.nodeId);
      if (existingNodeMapping && existingNodeMapping.id !== id) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: `Node "${request.nodeId}" already has an S7 mapping`,
          },
        };
      }
    }

    // Validate new PLC address uniqueness if provided
    if (request.plcAddress && request.plcAddress !== existing.plcAddress) {
      const existingAddr = this.findMappingByConnectionAndAddress(existing.connectionId, request.plcAddress);
      if (existingAddr && existingAddr.id !== id) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: `PLC address "${request.plcAddress}" is already mapped in this connection`,
          },
        };
      }
    }

    const updated = this.database.write((db) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (request.plcAddress !== undefined) { updates.push('plc_address = ?'); values.push(request.plcAddress); }
      if (request.nodeId !== undefined) { updates.push('node_id = ?'); values.push(request.nodeId); }

      if (updates.length > 0) {
        values.push(id);
        db.prepare(`UPDATE s7_mappings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }

      return db.prepare('SELECT * FROM s7_mappings WHERE id = ?').get(id) as S7MappingRow;
    });

    return { success: true, data: rowToMapping(updated) };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Check if a node exists in the nodes table.
   */
  private nodeExists(nodeId: string): boolean {
    try {
      const conn = this.database.getConnection();
      const row = conn.prepare('SELECT id FROM nodes WHERE id = ?').get(nodeId);
      return !!row;
    } catch {
      return false;
    }
  }

  /**
   * Find a mapping by node ID (for uniqueness validation).
   */
  private findMappingByNodeId(nodeId: string): S7MappingRow | undefined {
    try {
      const conn = this.database.getConnection();
      return conn.prepare(
        'SELECT * FROM s7_mappings WHERE node_id = ?'
      ).get(nodeId) as S7MappingRow | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find a mapping by connection ID and PLC address (for uniqueness validation).
   */
  private findMappingByConnectionAndAddress(connectionId: string, plcAddress: string): S7MappingRow | undefined {
    try {
      const conn = this.database.getConnection();
      return conn.prepare(
        'SELECT * FROM s7_mappings WHERE connection_id = ? AND plc_address = ?'
      ).get(connectionId, plcAddress) as S7MappingRow | undefined;
    } catch {
      return undefined;
    }
  }
}

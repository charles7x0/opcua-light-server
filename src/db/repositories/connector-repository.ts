import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database.js';
import type { ConnectionConfig, ConnectorType, Mapping } from '../../connectors/types.js';

/** Result type for repository operations that can fail with a domain error. */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: { field: string; message: string }[] } };

/** Bulk operation result with per-item reporting. */
export interface BulkResult<T> {
  created: T[];
  errors: { index: number; error: { code: string; message: string; details?: { field: string; message: string }[] } }[];
}

/** Request body for creating a connection. */
export interface CreateConnectionRequest {
  type: ConnectorType;
  name: string;
  params: Record<string, unknown>;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
  enabled?: boolean;
}

/** Request body for updating a connection. */
export interface UpdateConnectionRequest {
  name?: string;
  params?: Record<string, unknown>;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
  enabled?: boolean;
}

/** Request body for creating a mapping. */
export interface CreateMappingRequest {
  connectionId: string;
  nodeId: string;
  deviceAddress: string;
  description?: string;
}

/** Request body for updating a mapping. */
export interface UpdateMappingRequest {
  deviceAddress?: string;
  nodeId?: string;
  description?: string;
}

/** Row shape returned from the connections table. */
interface ConnectionRow {
  id: string;
  type: string;
  name: string;
  params: string;
  polling_interval_ms: number;
  reconnect_interval_ms: number;
  enabled: number;
  created_at: string;
}

/** Row shape returned from the mappings table. */
interface MappingRow {
  id: string;
  connection_id: string;
  node_id: string;
  device_address: string;
  description: string | null;
  created_at: string;
}

/**
 * Maps a database row to a ConnectionConfig domain object.
 */
function rowToConnection(row: ConnectionRow): ConnectionConfig {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    params: JSON.parse(row.params),
    pollingIntervalMs: row.polling_interval_ms,
    reconnectIntervalMs: row.reconnect_interval_ms,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

/**
 * Maps a database row to a Mapping domain object.
 */
function rowToMapping(row: MappingRow): Mapping {
  return {
    id: row.id,
    connectionId: row.connection_id,
    nodeId: row.node_id,
    deviceAddress: row.device_address,
    description: row.description ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Repository for managing generalized protocol connections and device-to-node mappings.
 * Provides CRUD operations with uniqueness constraint enforcement.
 */
export class ConnectorRepository {
  constructor(private database: Database) {}

  // ─── Connection CRUD ──────────────────────────────────────────────────────────

  /**
   * Create a new connection.
   */
  createConnection(request: CreateConnectionRequest): Result<ConnectionConfig> {
    const id = uuidv4();

    const connection = this.database.write((db) => {
      db.prepare(
        `INSERT INTO connections (id, type, name, params, polling_interval_ms, reconnect_interval_ms, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        id,
        request.type,
        request.name,
        JSON.stringify(request.params),
        request.pollingIntervalMs ?? 1000,
        request.reconnectIntervalMs ?? 5000,
        request.enabled !== undefined ? (request.enabled ? 1 : 0) : 1
      );

      return db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow;
    });

    return { success: true, data: rowToConnection(connection) };
  }

  /**
   * Retrieve all connections, optionally filtered by type.
   */
  findAllConnections(type?: ConnectorType): ConnectionConfig[] {
    const cacheKey = type ? `connections:type:${type}` : 'connections';

    return this.database.readWithCache(cacheKey, (db) => {
      if (type) {
        const rows = db.prepare(
          'SELECT * FROM connections WHERE type = ? ORDER BY name'
        ).all(type) as ConnectionRow[];
        return rows.map(rowToConnection);
      }

      const rows = db.prepare(
        'SELECT * FROM connections ORDER BY name'
      ).all() as ConnectionRow[];
      return rows.map(rowToConnection);
    });
  }

  /**
   * Find a connection by its ID.
   * Returns null if not found.
   */
  findConnectionById(id: string): ConnectionConfig | null {
    return this.database.readWithCache(`connection:${id}`, (db) => {
      const row = db.prepare(
        'SELECT * FROM connections WHERE id = ?'
      ).get(id) as ConnectionRow | undefined;

      if (!row) return [];
      return [rowToConnection(row)];
    })[0] ?? null;
  }

  /**
   * Update an existing connection.
   * Only provided fields are updated.
   */
  updateConnection(id: string, request: UpdateConnectionRequest): Result<ConnectionConfig> {
    const existing = this.findConnectionById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Connection with id "${id}" not found`,
        },
      };
    }

    const updated = this.database.write((db) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (request.name !== undefined) { updates.push('name = ?'); values.push(request.name); }
      if (request.params !== undefined) { updates.push('params = ?'); values.push(JSON.stringify(request.params)); }
      if (request.pollingIntervalMs !== undefined) { updates.push('polling_interval_ms = ?'); values.push(request.pollingIntervalMs); }
      if (request.reconnectIntervalMs !== undefined) { updates.push('reconnect_interval_ms = ?'); values.push(request.reconnectIntervalMs); }
      if (request.enabled !== undefined) { updates.push('enabled = ?'); values.push(request.enabled ? 1 : 0); }

      if (updates.length === 0) {
        return db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow;
      }

      values.push(id);
      db.prepare(`UPDATE connections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow;
    });

    return { success: true, data: rowToConnection(updated) };
  }

  /**
   * Delete a connection by ID.
   * Cascade deletion of associated mappings is handled by SQLite foreign keys.
   */
  deleteConnection(id: string): Result<void> {
    const existing = this.findConnectionById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Connection with id "${id}" not found`,
        },
      };
    }

    this.database.write((db) => {
      db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    });

    return { success: true, data: undefined };
  }

  // ─── Mapping CRUD ─────────────────────────────────────────────────────────────

  /**
   * Create a new mapping.
   * Enforces:
   * - One mapping per node (UNIQUE(node_id))
   * - Unique device address per connection (UNIQUE(connection_id, device_address))
   */
  createMapping(request: CreateMappingRequest): Result<Mapping> {
    // Validate that the connection exists
    const connection = this.findConnectionById(request.connectionId);
    if (!connection) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Connection with id "${request.connectionId}" not found`,
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
          message: `Node "${request.nodeId}" already has a mapping`,
          details: [{ field: 'nodeId', message: `Node "${request.nodeId}" is already mapped to a device address` }],
        },
      };
    }

    // Check unique constraint: unique device address per connection
    const existingAddressMapping = this.findMappingByConnectionAndAddress(
      request.connectionId,
      request.deviceAddress
    );
    if (existingAddressMapping) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ERROR',
          message: `Device address "${request.deviceAddress}" is already mapped in connection "${request.connectionId}"`,
          details: [{ field: 'deviceAddress', message: `Device address "${request.deviceAddress}" is already in use for this connection` }],
        },
      };
    }

    const id = uuidv4();

    const mapping = this.database.write((db) => {
      db.prepare(
        `INSERT INTO mappings (id, connection_id, node_id, device_address, description, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).run(id, request.connectionId, request.nodeId, request.deviceAddress, request.description ?? null);

      return db.prepare('SELECT * FROM mappings WHERE id = ?').get(id) as MappingRow;
    });

    return { success: true, data: rowToMapping(mapping) };
  }

  /**
   * Retrieve all mappings, optionally filtered by connection ID.
   */
  findAllMappings(connectionId?: string): Mapping[] {
    const cacheKey = connectionId ? `mappings:connection:${connectionId}` : 'mappings';

    return this.database.readWithCache(cacheKey, (db) => {
      if (connectionId) {
        const rows = db.prepare(
          'SELECT * FROM mappings WHERE connection_id = ? ORDER BY device_address'
        ).all(connectionId) as MappingRow[];
        return rows.map(rowToMapping);
      }

      const rows = db.prepare(
        'SELECT * FROM mappings ORDER BY connection_id, device_address'
      ).all() as MappingRow[];
      return rows.map(rowToMapping);
    });
  }

  /**
   * Find a mapping by its ID.
   * Returns null if not found.
   */
  findMappingById(id: string): Mapping | null {
    return this.database.readWithCache(`mapping:${id}`, (db) => {
      const row = db.prepare(
        'SELECT * FROM mappings WHERE id = ?'
      ).get(id) as MappingRow | undefined;

      if (!row) return [];
      return [rowToMapping(row)];
    })[0] ?? null;
  }

  /**
   * Update an existing mapping.
   * Allows changing the device address, node ID, or description.
   */
  updateMapping(id: string, request: UpdateMappingRequest): Result<Mapping> {
    const existing = this.findMappingById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Mapping with id "${id}" not found`,
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
            message: `Node "${request.nodeId}" already has a mapping`,
          },
        };
      }
    }

    // Validate new device address uniqueness if provided
    if (request.deviceAddress && request.deviceAddress !== existing.deviceAddress) {
      const existingAddr = this.findMappingByConnectionAndAddress(existing.connectionId, request.deviceAddress);
      if (existingAddr && existingAddr.id !== id) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: `Device address "${request.deviceAddress}" is already mapped in this connection`,
          },
        };
      }
    }

    const updated = this.database.write((db) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (request.deviceAddress !== undefined) { updates.push('device_address = ?'); values.push(request.deviceAddress); }
      if (request.nodeId !== undefined) { updates.push('node_id = ?'); values.push(request.nodeId); }
      if (request.description !== undefined) { updates.push('description = ?'); values.push(request.description); }

      if (updates.length > 0) {
        values.push(id);
        db.prepare(`UPDATE mappings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }

      return db.prepare('SELECT * FROM mappings WHERE id = ?').get(id) as MappingRow;
    });

    return { success: true, data: rowToMapping(updated) };
  }

  /**
   * Delete a mapping by ID.
   */
  deleteMapping(id: string): Result<void> {
    const existing = this.findMappingById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Mapping with id "${id}" not found`,
        },
      };
    }

    this.database.write((db) => {
      db.prepare('DELETE FROM mappings WHERE id = ?').run(id);
    });

    return { success: true, data: undefined };
  }

  /**
   * Create multiple mappings in a single operation with per-item success/failure reporting.
   */
  createMappingsBulk(requests: CreateMappingRequest[]): BulkResult<Mapping> {
    const created: Mapping[] = [];
    const errors: BulkResult<Mapping>['errors'] = [];

    for (let i = 0; i < requests.length; i++) {
      const result = this.createMapping(requests[i]);
      if (result.success) {
        created.push(result.data);
      } else {
        errors.push({ index: i, error: result.error });
      }
    }

    return { created, errors };
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
  private findMappingByNodeId(nodeId: string): MappingRow | undefined {
    try {
      const conn = this.database.getConnection();
      return conn.prepare(
        'SELECT * FROM mappings WHERE node_id = ?'
      ).get(nodeId) as MappingRow | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find a mapping by connection ID and device address (for uniqueness validation).
   */
  private findMappingByConnectionAndAddress(connectionId: string, deviceAddress: string): MappingRow | undefined {
    try {
      const conn = this.database.getConnection();
      return conn.prepare(
        'SELECT * FROM mappings WHERE connection_id = ? AND device_address = ?'
      ).get(connectionId, deviceAddress) as MappingRow | undefined;
    } catch {
      return undefined;
    }
  }
}

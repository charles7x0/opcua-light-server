import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database.js';
import type { OpcUaNode, OpcUaDataType } from '../../types/index.js';
import type { CreateNodeRequest, UpdateNodeRequest } from '../../types/api.js';
import type { Result, DomainError } from '../../types/result.js';

/** Supported OPC UA data types for validation. */
const SUPPORTED_DATA_TYPES: OpcUaDataType[] = [
  'Boolean',
  'Int16',
  'Int32',
  'Int64',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float',
  'Double',
  'String',
  'DateTime',
  'ByteString',
];

/** Validation error with field-level detail. */
export interface ValidationError {
  field: string;
  message: string;
}

/** Result of a validation check. */
export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

/** Raw row shape from the nodes table. */
interface NodeRow {
  id: string;
  namespace_id: string;
  object_node_id: string | null;
  name: string;
  data_type: string;
  initial_value: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Repository for OPC UA Node CRUD operations with validation.
 */
export class NodeRepository {
  constructor(private readonly database: Database) {}

  /**
   * Create a new node after validating the request.
   * Returns a Result with the created node or a domain error.
   */
  create(request: CreateNodeRequest): Result<OpcUaNode> {
    const validation = this.validateCreate(request);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
          details: validation.errors,
        },
      };
    }

    // Check name uniqueness within namespace
    const duplicate = this.findByNameInNamespace(request.name, request.namespaceId);
    if (duplicate) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ERROR',
          message: `Duplicate node name '${request.name}' within namespace '${request.namespaceId}'`,
          details: [
            { field: 'name', message: `Node name '${request.name}' already exists in this namespace` },
          ],
        },
      };
    }

    const id = uuidv4();
    const initialValue =
      request.initialValue !== undefined ? JSON.stringify(request.initialValue) : null;

    const node = this.database.write((db) => {
      db.prepare(
        `INSERT INTO nodes (id, namespace_id, object_node_id, name, data_type, initial_value, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        request.namespaceId,
        request.objectNodeId ?? null,
        request.name,
        request.dataType,
        initialValue,
        request.description ?? null
      );

      return this.mapRow(
        db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow
      );
    });

    return { success: true, data: node };
  }

  /**
   * Retrieve all nodes, optionally filtered by namespaceId.
   */
  findAll(namespaceId?: string): OpcUaNode[] {
    const cacheKey = namespaceId ? `nodes:ns:${namespaceId}` : 'nodes:all';

    return this.database.readWithCache(cacheKey, (db) => {
      if (namespaceId) {
        const rows = db
          .prepare('SELECT * FROM nodes WHERE namespace_id = ? ORDER BY name')
          .all(namespaceId) as NodeRow[];
        return rows.map((row) => this.mapRow(row));
      }
      const rows = db
        .prepare('SELECT * FROM nodes ORDER BY name')
        .all() as NodeRow[];
      return rows.map((row) => this.mapRow(row));
    });
  }

  /**
   * Retrieve a single node by ID. Returns null if not found.
   */
  findById(id: string): OpcUaNode | null {
    return this.database.readWithCache(`nodes:${id}`, (db) => {
      const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as
        | NodeRow
        | undefined;
      return row ? [this.mapRow(row)] : [];
    })[0] ?? null;
  }

  /**
   * Update an existing node. Only provided fields are updated.
   * Returns a Result with the updated node or a domain error.
   */
  update(id: string, request: UpdateNodeRequest): Result<OpcUaNode> {
    const existing = this.findById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Node with id '${id}' not found`,
        },
      };
    }

    const validation = this.validateUpdate(request, existing);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
          details: validation.errors,
        },
      };
    }

    // Check name uniqueness if name is being changed
    if (request.name && request.name !== existing.name) {
      const duplicate = this.findByNameInNamespace(request.name, existing.namespaceId);
      if (duplicate) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: `Duplicate node name '${request.name}' within namespace '${existing.namespaceId}'`,
            details: [
              { field: 'name', message: `Node name '${request.name}' already exists in this namespace` },
            ],
          },
        };
      }
    }

    const node = this.database.write((db) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (request.name !== undefined) {
        updates.push('name = ?');
        values.push(request.name);
      }
      if (request.objectNodeId !== undefined) {
        updates.push('object_node_id = ?');
        values.push(request.objectNodeId);
      }
      if (request.dataType !== undefined) {
        updates.push('data_type = ?');
        values.push(request.dataType);
      }
      if (request.initialValue !== undefined) {
        updates.push('initial_value = ?');
        values.push(JSON.stringify(request.initialValue));
      }
      if (request.description !== undefined) {
        updates.push('description = ?');
        values.push(request.description);
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        values.push(id);

        db.prepare(
          `UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`
        ).run(...values);
      }

      return this.mapRow(
        db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow
      );
    });

    return { success: true, data: node };
  }

  /**
   * Delete a node by ID. Returns a Result indicating success or not-found.
   */
  delete(id: string): Result<void> {
    return this.database.write((db) => {
      const result = db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
      if (result.changes > 0) {
        return { success: true as const, data: undefined };
      }
      return {
        success: false as const,
        error: {
          code: 'NOT_FOUND' as const,
          message: `Node with id '${id}' not found`,
        },
      };
    });
  }

  /**
   * Find a node by name within a specific namespace.
   */
  private findByNameInNamespace(name: string, namespaceId: string): OpcUaNode | null {
    const rows = this.database.readWithCache(
      `nodes:lookup:${namespaceId}:${name}`,
      (db) => {
        const row = db
          .prepare('SELECT * FROM nodes WHERE name = ? AND namespace_id = ?')
          .get(name, namespaceId) as NodeRow | undefined;
        return row ? [this.mapRow(row)] : [];
      }
    );
    return rows[0] ?? null;
  }

  /**
   * Validate a create request.
   */
  private validateCreate(request: CreateNodeRequest): ValidationResult {
    const errors: ValidationError[] = [];

    if (!request.name || request.name.trim() === '') {
      errors.push({ field: 'name', message: 'Name is required' });
    }

    if (!request.namespaceId || request.namespaceId.trim() === '') {
      errors.push({ field: 'namespaceId', message: 'Namespace ID is required' });
    }

    if (!request.dataType) {
      errors.push({ field: 'dataType', message: 'Data type is required' });
    } else if (!SUPPORTED_DATA_TYPES.includes(request.dataType)) {
      errors.push({
        field: 'dataType',
        message: `Unsupported data type: '${request.dataType}'. Supported types: ${SUPPORTED_DATA_TYPES.join(', ')}`,
      });
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  /**
   * Validate an update request.
   */
  private validateUpdate(request: UpdateNodeRequest, _existing: OpcUaNode): ValidationResult {
    const errors: ValidationError[] = [];

    if (request.name !== undefined && request.name.trim() === '') {
      errors.push({ field: 'name', message: 'Name cannot be empty' });
    }

    if (request.dataType !== undefined && !SUPPORTED_DATA_TYPES.includes(request.dataType)) {
      errors.push({
        field: 'dataType',
        message: `Unsupported data type: '${request.dataType}'. Supported types: ${SUPPORTED_DATA_TYPES.join(', ')}`,
      });
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  /**
   * Map a database row to an OpcUaNode domain object.
   */
  private mapRow(row: NodeRow): OpcUaNode {
    return {
      id: row.id,
      namespaceId: row.namespace_id,
      objectNodeId: row.object_node_id,
      name: row.name,
      dataType: row.data_type as OpcUaDataType,
      initialValue: row.initial_value ? JSON.parse(row.initial_value) : undefined,
      description: row.description ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

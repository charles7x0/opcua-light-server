import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database.js';
import type { Namespace } from '../../types/index.js';
import type { CreateNamespaceRequest, UpdateNamespaceRequest } from '../../types/api.js';

/** Result type for repository operations that can fail with a domain error. */
export type NamespaceResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: { field: string; message: string }[] } };

/** Row shape returned from the namespaces table. */
interface NamespaceRow {
  id: string;
  name: string;
  description: string | null;
  uri: string;
  created_at: string;
  updated_at: string;
}

/** Row shape returned from the namespaces table with node count. */
interface NamespaceWithCountRow extends NamespaceRow {
  node_count: number;
}

/**
 * Maps a database row to a Namespace domain object.
 */
function rowToNamespace(row: NamespaceRow, nodeCount?: number): Namespace {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    uri: row.uri,
    nodeCount: nodeCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Repository for managing Namespace entities in the SQLite database.
 * Provides CRUD operations with uniqueness validation and node count aggregation.
 */
export class NamespaceRepository {
  constructor(private database: Database) {}

  /**
   * Create a new namespace.
   * Validates that the namespace name and URI are unique before inserting.
   */
  create(request: CreateNamespaceRequest): NamespaceResult<Namespace> {
    // Validate uniqueness of name
    const nameConflict = this.findByName(request.name);
    if (nameConflict) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ERROR',
          message: `A namespace with the name "${request.name}" already exists`,
          details: [{ field: 'name', message: `Namespace name "${request.name}" is already in use` }],
        },
      };
    }

    // Validate uniqueness of URI
    const uriConflict = this.findByUri(request.uri);
    if (uriConflict) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ERROR',
          message: `A namespace with the URI "${request.uri}" already exists`,
          details: [{ field: 'uri', message: `Namespace URI "${request.uri}" is already in use` }],
        },
      };
    }

    const id = uuidv4();
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    const namespace = this.database.write((db) => {
      db.prepare(
        `INSERT INTO namespaces (id, name, description, uri, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run(id, request.name, request.description ?? null, request.uri);

      return db.prepare('SELECT * FROM namespaces WHERE id = ?').get(id) as NamespaceRow;
    });

    return { success: true, data: rowToNamespace(namespace, 0) };
  }

  /**
   * Retrieve all namespaces with their node counts.
   */
  findAll(): Namespace[] {
    return this.database.readWithCache('namespaces', (db) => {
      const rows = db.prepare(
        `SELECT n.*, COUNT(nodes.id) as node_count
         FROM namespaces n
         LEFT JOIN nodes ON nodes.namespace_id = n.id
         GROUP BY n.id
         ORDER BY n.name`
      ).all() as NamespaceWithCountRow[];

      return rows.map((row) => rowToNamespace(row, row.node_count));
    });
  }

  /**
   * Find a namespace by its ID.
   * Returns null if not found.
   */
  findById(id: string): Namespace | null {
    return this.database.readWithCache(`namespace:${id}`, (db) => {
      const row = db.prepare(
        `SELECT n.*, COUNT(nodes.id) as node_count
         FROM namespaces n
         LEFT JOIN nodes ON nodes.namespace_id = n.id
         WHERE n.id = ?
         GROUP BY n.id`
      ).get(id) as NamespaceWithCountRow | undefined;

      if (!row) return [];
      return [rowToNamespace(row, row.node_count)];
    })[0] ?? null;
  }

  /**
   * Update an existing namespace.
   * Validates uniqueness of name and URI if they are being changed.
   */
  update(id: string, request: UpdateNamespaceRequest): NamespaceResult<Namespace> {
    const existing = this.findById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Namespace with id "${id}" not found`,
        },
      };
    }

    // Validate uniqueness of name if it's being changed
    if (request.name && request.name !== existing.name) {
      const nameConflict = this.findByName(request.name);
      if (nameConflict) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: `A namespace with the name "${request.name}" already exists`,
            details: [{ field: 'name', message: `Namespace name "${request.name}" is already in use` }],
          },
        };
      }
    }

    // Validate uniqueness of URI if it's being changed
    if (request.uri && request.uri !== existing.uri) {
      const uriConflict = this.findByUri(request.uri);
      if (uriConflict) {
        return {
          success: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: `A namespace with the URI "${request.uri}" already exists`,
            details: [{ field: 'uri', message: `Namespace URI "${request.uri}" is already in use` }],
          },
        };
      }
    }

    const updated = this.database.write((db) => {
      const name = request.name ?? existing.name;
      const description = request.description !== undefined ? request.description : (existing.description ?? null);
      const uri = request.uri ?? existing.uri;

      db.prepare(
        `UPDATE namespaces
         SET name = ?, description = ?, uri = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(name, description ?? null, uri, id);

      return db.prepare('SELECT * FROM namespaces WHERE id = ?').get(id) as NamespaceRow;
    });

    // Get node count for the updated namespace
    const nodeCount = this.database.readWithCache(`namespace-nodecount:${id}`, (db) => {
      const row = db.prepare(
        'SELECT COUNT(*) as count FROM nodes WHERE namespace_id = ?'
      ).get(id) as { count: number };
      return [row.count];
    })[0] ?? 0;

    return { success: true, data: rowToNamespace(updated, nodeCount as number) };
  }

  /**
   * Delete a namespace by ID.
   * Cascade deletion of associated folders and nodes is handled by SQLite foreign keys.
   */
  delete(id: string): NamespaceResult<void> {
    const existing = this.findById(id);
    if (!existing) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Namespace with id "${id}" not found`,
        },
      };
    }

    this.database.write((db) => {
      db.prepare('DELETE FROM namespaces WHERE id = ?').run(id);
    });

    return { success: true, data: undefined };
  }

  /**
   * Find a namespace by its name (for uniqueness validation).
   */
  private findByName(name: string): NamespaceRow | undefined {
    try {
      const conn = this.database.getConnection();
      return conn.prepare('SELECT * FROM namespaces WHERE name = ?').get(name) as NamespaceRow | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find a namespace by its URI (for uniqueness validation).
   */
  private findByUri(uri: string): NamespaceRow | undefined {
    try {
      const conn = this.database.getConnection();
      return conn.prepare('SELECT * FROM namespaces WHERE uri = ?').get(uri) as NamespaceRow | undefined;
    } catch {
      return undefined;
    }
  }
}

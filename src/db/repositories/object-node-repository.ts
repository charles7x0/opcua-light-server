import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database.js';
import type { ObjectNode } from '../../types/index.js';

/** Maximum nesting depth for object nodes. */
const MAX_DEPTH = 5;

/**
 * Row shape returned from the object_nodes table.
 */
interface ObjectNodeRow {
  id: string;
  namespace_id: string;
  parent_object_node_id: string | null;
  name: string;
  created_at: string;
}

/**
 * Input for creating a new object node.
 */
export interface CreateObjectNodeInput {
  namespaceId: string;
  parentObjectNodeId?: string | null;
  name: string;
}

/**
 * Repository for managing OPC UA object node CRUD operations and hierarchy queries.
 * Object nodes are containers that use HasComponent references in the OPC UA address space.
 * Maximum nesting depth is 5 levels.
 */
export class ObjectNodeRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /**
   * Create a new object node within a namespace.
   * Validates uniqueness of name within the same parent and enforces max depth of 5.
   */
  create(input: CreateObjectNodeInput): ObjectNode {
    const { namespaceId, parentObjectNodeId = null, name } = input;

    return this.database.write((db) => {
      // Validate that the namespace exists
      const namespace = db
        .prepare('SELECT id FROM namespaces WHERE id = ?')
        .get(namespaceId);
      if (!namespace) {
        throw new ObjectNodeValidationError(
          `Namespace with id '${namespaceId}' does not exist`
        );
      }

      // Validate that the parent object node exists (if specified)
      if (parentObjectNodeId !== null && parentObjectNodeId !== undefined) {
        const parentNode = db
          .prepare('SELECT id FROM object_nodes WHERE id = ?')
          .get(parentObjectNodeId);
        if (!parentNode) {
          throw new ObjectNodeValidationError(
            `Parent object node with id '${parentObjectNodeId}' does not exist`
          );
        }

        // Validate depth limit
        const depth = this.computeDepth(db, parentObjectNodeId);
        if (depth >= MAX_DEPTH) {
          throw new ObjectNodeValidationError(
            `Maximum nesting depth of ${MAX_DEPTH} levels exceeded`
          );
        }
      }

      const id = uuidv4();

      try {
        db.prepare(
          `INSERT INTO object_nodes (id, namespace_id, parent_object_node_id, name)
           VALUES (?, ?, ?, ?)`
        ).run(id, namespaceId, parentObjectNodeId, name);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message.includes('UNIQUE constraint failed')
        ) {
          throw new ObjectNodeDuplicateError(
            `An object node named '${name}' already exists in this location`
          );
        }
        throw error;
      }

      const row = db
        .prepare('SELECT * FROM object_nodes WHERE id = ?')
        .get(id) as ObjectNodeRow;

      return this.mapRowToObjectNode(row);
    });
  }

  /**
   * Retrieve the full object node hierarchy for a namespace as a nested tree.
   * Returns root-level object nodes with recursively nested children.
   */
  findTreeByNamespace(namespaceId: string): ObjectNode[] {
    return this.database.readWithCache(
      `object-nodes:tree:${namespaceId}`,
      (db) => {
        const rows = db
          .prepare(
            'SELECT * FROM object_nodes WHERE namespace_id = ? ORDER BY name'
          )
          .all(namespaceId) as ObjectNodeRow[];

        return this.buildTree(rows);
      }
    );
  }

  /**
   * Delete an object node by ID.
   * Before deletion, reassigns all variable nodes in this object node to the parent
   * (or null if the object node is at root level).
   */
  delete(id: string): void {
    this.database.write((db) => {
      const objectNode = db
        .prepare('SELECT * FROM object_nodes WHERE id = ?')
        .get(id) as ObjectNodeRow | undefined;

      if (!objectNode) {
        throw new ObjectNodeNotFoundError(`Object node with id '${id}' not found`);
      }

      // Reassign variable nodes in this object node to the parent (or null for root)
      db.prepare(
        'UPDATE nodes SET object_node_id = ? WHERE object_node_id = ?'
      ).run(objectNode.parent_object_node_id, id);

      // Reassign child object nodes to the parent (or null for root)
      db.prepare(
        'UPDATE object_nodes SET parent_object_node_id = ? WHERE parent_object_node_id = ?'
      ).run(objectNode.parent_object_node_id, id);

      // Delete the object node
      db.prepare('DELETE FROM object_nodes WHERE id = ?').run(id);
    });
  }

  /**
   * Compute the depth of a given object node (1-based: root-level = 1).
   */
  private computeDepth(db: import('better-sqlite3').Database, objectNodeId: string): number {
    let depth = 1;
    let currentId: string | null = objectNodeId;

    while (currentId) {
      const row = db
        .prepare('SELECT parent_object_node_id FROM object_nodes WHERE id = ?')
        .get(currentId) as { parent_object_node_id: string | null } | undefined;

      if (!row || row.parent_object_node_id === null) break;
      currentId = row.parent_object_node_id;
      depth++;
    }

    return depth;
  }

  /**
   * Build a nested tree structure from a flat list of object node rows.
   */
  private buildTree(rows: ObjectNodeRow[]): ObjectNode[] {
    const nodeMap = new Map<string, ObjectNode>();
    const roots: ObjectNode[] = [];

    // First pass: create all object node objects
    for (const row of rows) {
      nodeMap.set(row.id, {
        id: row.id,
        namespaceId: row.namespace_id,
        parentObjectNodeId: row.parent_object_node_id,
        name: row.name,
        children: [],
        createdAt: row.created_at,
      });
    }

    // Second pass: build parent-child relationships
    for (const row of rows) {
      const node = nodeMap.get(row.id)!;
      if (row.parent_object_node_id === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(row.parent_object_node_id);
        if (parent) {
          parent.children!.push(node);
        } else {
          // Parent not in this namespace (shouldn't happen), treat as root
          roots.push(node);
        }
      }
    }

    return roots;
  }

  /**
   * Map a database row to an ObjectNode domain object.
   */
  private mapRowToObjectNode(row: ObjectNodeRow): ObjectNode {
    return {
      id: row.id,
      namespaceId: row.namespace_id,
      parentObjectNodeId: row.parent_object_node_id,
      name: row.name,
      createdAt: row.created_at,
    };
  }
}

/**
 * Error thrown when object node validation fails.
 */
export class ObjectNodeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectNodeValidationError';
  }
}

/**
 * Error thrown when a duplicate object node name is detected.
 */
export class ObjectNodeDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectNodeDuplicateError';
  }
}

/**
 * Error thrown when an object node is not found.
 */
export class ObjectNodeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectNodeNotFoundError';
  }
}

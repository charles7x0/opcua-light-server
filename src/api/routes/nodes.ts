import { Router } from 'express';
import type { Request, Response } from 'express';
import type { NodeRepository } from '../../db/repositories/node-repository.js';
import type { ErrorResponse } from '../../types/api.js';
import type { CreateNodeRequest, UpdateNodeRequest } from '../../types/api.js';
import type { Database } from '../../db/database.js';
import type { OpcUaDataType } from '../../types/index.js';

/** Supported OPC UA data types for CSV import validation. */
const VALID_DATA_TYPES: OpcUaDataType[] = [
  'Boolean', 'Int16', 'Int32', 'Int64', 'UInt16', 'UInt32', 'UInt64',
  'Float', 'Double', 'String', 'DateTime', 'ByteString',
];

/**
 * Creates the Express router for Node CRUD endpoints.
 *
 * @param repository - Node repository for CRUD operations.
 * @param database - Optional Database instance required for CSV import/export
 *   endpoints (`GET /export/csv`, `POST /import/csv`). When omitted, those
 *   endpoints return a 500 error.
 */
export function createNodeRoutes(repository: NodeRepository, database?: Database): Router {
  const router = Router();

  // POST /api/nodes - Create a node
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body as CreateNodeRequest;
      const node = repository.create(body);
      res.status(201).json(node);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // GET /api/nodes - List nodes (optional ?namespaceId filter)
  router.get('/', (req: Request, res: Response) => {
    try {
      const namespaceId = typeof req.query.namespaceId === 'string'
        ? req.query.namespaceId
        : undefined;
      const nodes = repository.findAll(namespaceId);
      res.json(nodes);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // ─── CSV Export ─────────────────────────────────────────────────────────────
  // NOTE: These must be registered BEFORE the /:id parameter route.

  /** GET /api/nodes/export/csv - Export all nodes as CSV */
  router.get('/export/csv', (_req: Request, res: Response) => {
    try {
      if (!database) {
        const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Database not available for export' } };
        res.status(500).json(errorResponse);
        return;
      }

      const db = database.getConnection();
      const nodes = repository.findAll();

      // Build lookup maps for namespace names and object node paths
      const namespaceRows = db.prepare('SELECT id, name FROM namespaces').all() as Array<{ id: string; name: string }>;
      const nsMap = new Map(namespaceRows.map((r) => [r.id, r.name]));

      const objectNodeRows = db.prepare('SELECT id, namespace_id, parent_object_node_id, name FROM object_nodes').all() as Array<{
        id: string; namespace_id: string; parent_object_node_id: string | null; name: string;
      }>;
      const objNodeMap = new Map(objectNodeRows.map((r) => [r.id, r]));

      function getObjectNodePath(objectNodeId: string | null): string {
        if (!objectNodeId) return '';
        const parts: string[] = [];
        let currentId: string | null = objectNodeId;
        while (currentId) {
          const node = objNodeMap.get(currentId);
          if (!node) break;
          parts.unshift(node.name);
          currentId = node.parent_object_node_id;
        }
        return parts.join('/');
      }

      // CSV header
      const csvLines: string[] = ['name,namespace,objectNodePath,dataType,initialValue,description'];

      for (const node of nodes) {
        const nsName = nsMap.get(node.namespaceId) ?? '';
        const objPath = getObjectNodePath(node.objectNodeId);
        const initialValue = node.initialValue !== undefined && node.initialValue !== null
          ? JSON.stringify(node.initialValue)
          : '';
        const description = node.description ?? '';

        csvLines.push([
          escapeCsvField(node.name),
          escapeCsvField(nsName),
          escapeCsvField(objPath),
          escapeCsvField(node.dataType),
          escapeCsvField(initialValue),
          escapeCsvField(description),
        ].join(','));
      }

      const csv = csvLines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="nodes.csv"');
      res.send(csv);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // ─── CSV Import ─────────────────────────────────────────────────────────────

  /** POST /api/nodes/import/csv - Import nodes from CSV */
  router.post('/import/csv', (req: Request, res: Response) => {
    try {
      if (!database) {
        const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Database not available for import' } };
        res.status(500).json(errorResponse);
        return;
      }

      const csvContent = req.body?.csv as string | undefined;
      if (!csvContent || typeof csvContent !== 'string') {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'Request body must include a "csv" field with the CSV content as a string' },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const db = database.getConnection();

      // Build lookup maps
      const namespaceRows = db.prepare('SELECT id, name FROM namespaces').all() as Array<{ id: string; name: string }>;
      const nsNameToId = new Map(namespaceRows.map((r) => [r.name, r.id]));

      const objectNodeRows = db.prepare('SELECT id, namespace_id, parent_object_node_id, name FROM object_nodes').all() as Array<{
        id: string; namespace_id: string; parent_object_node_id: string | null; name: string;
      }>;

      // Build object node path lookup: "path" → id per namespace
      function findObjectNodeByPath(namespaceId: string, pathStr: string): string | null {
        if (!pathStr) return null;
        const parts = pathStr.split('/').map((p) => p.trim()).filter(Boolean);
        if (parts.length === 0) return null;

        const nsObjNodes = objectNodeRows.filter((r) => r.namespace_id === namespaceId);
        let parentId: string | null = null;

        for (const part of parts) {
          const found = nsObjNodes.find((r) => r.name === part && r.parent_object_node_id === parentId);
          if (!found) return null;
          parentId = found.id;
        }

        return parentId;
      }

      // Parse CSV
      const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'CSV must contain a header row and at least one data row' },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Validate header
      const header = parseCsvLine(lines[0]);
      const normalizedHeader = header.map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
      if (normalizedHeader.length < 4 || normalizedHeader[0] !== 'name' || normalizedHeader[1] !== 'namespace' || normalizedHeader[3] !== 'datatype') {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'CSV header must have columns: name,namespace,objectNodePath,dataType,initialValue,description' },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const results: Array<{ row: number; success: boolean; name?: string; error?: string }> = [];

      for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < 4) {
          results.push({ row: i + 1, success: false, error: 'Insufficient columns' });
          continue;
        }

        const [name, namespaceName, objectNodePath, dataType, initialValueStr, description] = fields;

        // Validate name
        if (!name?.trim()) {
          results.push({ row: i + 1, success: false, error: 'Name is required' });
          continue;
        }

        // Resolve namespace
        const namespaceId = nsNameToId.get(namespaceName?.trim() ?? '');
        if (!namespaceId) {
          results.push({ row: i + 1, success: false, name, error: `Namespace "${namespaceName}" not found` });
          continue;
        }

        // Validate data type
        if (!VALID_DATA_TYPES.includes(dataType?.trim() as OpcUaDataType)) {
          results.push({ row: i + 1, success: false, name, error: `Invalid dataType "${dataType}"` });
          continue;
        }

        // Resolve object node path
        const objectNodeId = findObjectNodeByPath(namespaceId, objectNodePath?.trim() ?? '');
        if (objectNodePath?.trim() && !objectNodeId) {
          results.push({ row: i + 1, success: false, name, error: `Object node path "${objectNodePath}" not found in namespace "${namespaceName}"` });
          continue;
        }

        // Parse initial value
        let initialValue: unknown = undefined;
        if (initialValueStr?.trim()) {
          try {
            initialValue = JSON.parse(initialValueStr.trim());
          } catch {
            initialValue = initialValueStr.trim();
          }
        }

        // Create node
        try {
          const createReq: CreateNodeRequest = {
            name: name.trim(),
            namespaceId,
            objectNodeId: objectNodeId ?? undefined,
            dataType: dataType.trim() as OpcUaDataType,
            initialValue,
            description: description?.trim() || undefined,
          };
          repository.create(createReq);
          results.push({ row: i + 1, success: true, name: name.trim() });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          results.push({ row: i + 1, success: false, name: name.trim(), error: msg });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      res.status(failed === 0 ? 201 : 207).json({
        summary: { total: results.length, succeeded, failed },
        results,
      });
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // ─── Single Node CRUD (parameterized routes) ────────────────────────────────

  // GET /api/nodes/:id - Get node by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const node = repository.findById(id);
      if (!node) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'NOT_FOUND',
            message: `Node with id '${id}' not found`,
          },
        };
        res.status(404).json(errorResponse);
        return;
      }
      res.json(node);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // PUT /api/nodes/:id - Update a node
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const body = req.body as UpdateNodeRequest;
      const node = repository.update(id, body);
      res.json(node);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // DELETE /api/nodes/:id - Delete a node
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const deleted = repository.delete(id);
      if (!deleted) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'NOT_FOUND',
            message: `Node with id '${id}' not found`,
          },
        };
        res.status(404).json(errorResponse);
        return;
      }
      res.status(204).send();
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  return router;
}

/**
 * Maps repository errors to appropriate HTTP error responses.
 */
function handleRepositoryError(res: Response, error: unknown): void {
  if (!(error instanceof Error)) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };
    res.status(500).json(errorResponse);
    return;
  }

  const err = error as Error & {
    validationErrors?: Array<{ field: string; message: string }>;
    isDuplicate?: boolean;
    isNotFound?: boolean;
  };

  if (err.isNotFound) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: err.message,
      },
    };
    res.status(404).json(errorResponse);
    return;
  }

  if (err.isDuplicate) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'DUPLICATE_ERROR',
        message: err.message,
        details: err.validationErrors,
      },
    };
    res.status(409).json(errorResponse);
    return;
  }

  if (err.validationErrors) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: err.validationErrors,
      },
    };
    res.status(400).json(errorResponse);
    return;
  }

  const errorResponse: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
    },
  };
  res.status(500).json(errorResponse);
}

// ─── CSV Utilities ──────────────────────────────────────────────────────────

/**
 * Escape a field for CSV output (RFC 4180 compliant).
 * Wraps in double quotes if the field contains commas, quotes, or newlines.
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Parse a single CSV line respecting quoted fields (RFC 4180).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        fields.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  fields.push(current);
  return fields;
}

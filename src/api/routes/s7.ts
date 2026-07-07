import { Router, Request, Response } from 'express';
import type { S7Repository } from '../../db/repositories/s7-repository.js';
import type { S7Connector } from '../../s7-connector/index.js';
import type { Database } from '../../db/database.js';
import type {
  CreateS7ConnectionRequest,
  CreateS7MappingRequest,
  ErrorResponse,
} from '../../types/api.js';
import type { S7ConnectionStatus } from '../../types/index.js';
import { escapeCsvField, parseCsvLine } from '../../utils/csv.js';

/**
 * Creates the S7 Connector API router.
 * Provides CRUD for connections, CRUD for mappings, connection status,
 * and CSV import/export of mappings.
 *
 * @param repository - S7 repository for persistence operations
 * @param s7Connector - Optional live S7 Connector instance for real-time status and value updates
 * @param database - Optional Database instance required for CSV export/import (node/namespace lookups)
 */
export function createS7Router(repository: S7Repository, s7Connector?: S7Connector, database?: Database): Router {
  const router = Router();

  // ─── Connection Endpoints ───────────────────────────────────────────────────

  /** POST /api/s7/connections - Create a new S7 connection */
  router.post('/connections', (req: Request, res: Response) => {
    const body = req.body as Partial<CreateS7ConnectionRequest>;

    // Validate required fields
    const errors: { field: string; message: string }[] = [];
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push({ field: 'name', message: 'Name is required' });
    }
    if (!body.host || typeof body.host !== 'string' || body.host.trim() === '') {
      errors.push({ field: 'host', message: 'Host is required' });
    }
    if (body.rack === undefined || body.rack === null || typeof body.rack !== 'number') {
      errors.push({ field: 'rack', message: 'Rack is required and must be a number' });
    }
    if (body.slot === undefined || body.slot === null || typeof body.slot !== 'number') {
      errors.push({ field: 'slot', message: 'Slot is required and must be a number' });
    }

    if (errors.length > 0) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: errors,
        },
      };
      return res.status(400).json(errorResponse);
    }

    const result = repository.createConnection(body as CreateS7ConnectionRequest);

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code as ErrorResponse['error']['code'],
          message: result.error.message,
          details: result.error.details,
        },
      };
      const status = result.error.code === 'DUPLICATE_ERROR' ? 409 : 400;
      return res.status(status).json(errorResponse);
    }

    return res.status(201).json(result.data);
  });

  /** GET /api/s7/connections - List all S7 connections */
  router.get('/connections', (_req: Request, res: Response) => {
    const connections = repository.findAllConnections();
    return res.json(connections);
  });

  /** DELETE /api/s7/connections/:id - Delete an S7 connection */
  router.delete('/connections/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const result = repository.deleteConnection(id);

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: result.error.message,
        },
      };
      return res.status(404).json(errorResponse);
    }

    return res.status(204).send();
  });

  /** PUT /api/s7/connections/:id - Update an S7 connection */
  router.put('/connections/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const body = req.body as Partial<{
      name: string;
      host: string;
      rack: number;
      slot: number;
      pollingIntervalMs: number;
      reconnectIntervalMs: number;
      enabled: boolean;
    }>;

    // Validate at least one field is provided
    if (!body.name && !body.host && body.rack === undefined && body.slot === undefined &&
        body.pollingIntervalMs === undefined && body.reconnectIntervalMs === undefined &&
        body.enabled === undefined) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one field must be provided for update',
        },
      };
      return res.status(400).json(errorResponse);
    }

    const result = repository.updateConnection(id, body);

    if (!result.success) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 400;
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code as ErrorResponse['error']['code'],
          message: result.error.message,
        },
      };
      return res.status(statusCode).json(errorResponse);
    }

    // Notify the S7 Connector about the config change so it reconnects
    if (s7Connector) {
      try {
        s7Connector.updateConnection(result.data);
      } catch {
        // Connector may not be tracking this connection yet — that's fine
      }
    }

    return res.status(200).json(result.data);
  });

  // ─── Mapping Endpoints ──────────────────────────────────────────────────────

  /** POST /api/s7/mappings - Create a new S7 mapping */
  router.post('/mappings', (req: Request, res: Response) => {
    const body = req.body as Partial<CreateS7MappingRequest>;

    // Validate required fields
    const errors: { field: string; message: string }[] = [];
    if (!body.connectionId || typeof body.connectionId !== 'string' || body.connectionId.trim() === '') {
      errors.push({ field: 'connectionId', message: 'Connection ID is required' });
    }
    if (!body.nodeId || typeof body.nodeId !== 'string' || body.nodeId.trim() === '') {
      errors.push({ field: 'nodeId', message: 'Node ID is required' });
    }
    if (!body.plcAddress || typeof body.plcAddress !== 'string' || body.plcAddress.trim() === '') {
      errors.push({ field: 'plcAddress', message: 'PLC address is required' });
    }

    if (errors.length > 0) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: errors,
        },
      };
      return res.status(400).json(errorResponse);
    }

    const result = repository.createMapping(body as CreateS7MappingRequest);

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code as ErrorResponse['error']['code'],
          message: result.error.message,
          details: result.error.details,
        },
      };
      let status: number;
      switch (result.error.code) {
        case 'NOT_FOUND':
          status = 404;
          break;
        case 'DUPLICATE_ERROR':
          status = 409;
          break;
        default:
          status = 400;
      }
      return res.status(status).json(errorResponse);
    }

    // Notify the S7 Connector so it starts polling this address
    if (s7Connector && result.data) {
      try {
        s7Connector.addMapping(result.data);
      } catch { /* connector may not have the connection tracked yet */ }
    }

    return res.status(201).json(result.data);
  });

  /** GET /api/s7/mappings - List all S7 mappings (optionally filtered by connectionId) */
  router.get('/mappings', (req: Request, res: Response) => {
    const connectionId = req.query.connectionId as string | undefined;
    const mappings = repository.findAllMappings(connectionId);
    return res.json(mappings);
  });

  /** DELETE /api/s7/mappings/:id - Delete an S7 mapping */
  router.delete('/mappings/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const result = repository.deleteMapping(id);

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: result.error.message,
        },
      };
      return res.status(404).json(errorResponse);
    }

    // Notify the S7 Connector to stop polling this address
    if (s7Connector) {
      try { s7Connector.removeMapping(id); } catch { /* may not exist in connector */ }
    }

    return res.status(204).send();
  });

  /** PUT /api/s7/mappings/:id - Update an S7 mapping */
  router.put('/mappings/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const body = req.body as Partial<{ plcAddress: string; nodeId: string; description: string }>;

    if (!body.plcAddress && !body.nodeId && body.description === undefined) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one field (plcAddress, nodeId, or description) must be provided',
        },
      };
      return res.status(400).json(errorResponse);
    }

    const result = repository.updateMapping(id, body);

    if (!result.success) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'DUPLICATE_ERROR' ? 409 : 400;
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code as ErrorResponse['error']['code'],
          message: result.error.message,
          details: result.error.details,
        },
      };
      return res.status(statusCode).json(errorResponse);
    }

    return res.status(200).json(result.data);
  });

  /** POST /api/s7/mappings/bulk - Create multiple S7 mappings at once */
  router.post('/mappings/bulk', (req: Request, res: Response) => {
    const body = req.body as Array<Partial<CreateS7MappingRequest>>;

    if (!Array.isArray(body) || body.length === 0) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body must be a non-empty array of mappings',
        },
      };
      return res.status(400).json(errorResponse);
    }

    const results: { index: number; success: boolean; data?: unknown; error?: string }[] = [];

    for (let i = 0; i < body.length; i++) {
      const item = body[i];
      if (!item.connectionId || !item.nodeId || !item.plcAddress) {
        results.push({ index: i, success: false, error: 'Missing required fields (connectionId, nodeId, plcAddress)' });
        continue;
      }

      const result = repository.createMapping({
        connectionId: item.connectionId,
        nodeId: item.nodeId,
        plcAddress: item.plcAddress,
      });

      if (result.success) {
        results.push({ index: i, success: true, data: result.data });
        // Notify the S7 Connector
        if (s7Connector && result.data) {
          try { s7Connector.addMapping(result.data); } catch { /* ignore */ }
        }
      } else {
        results.push({ index: i, success: false, error: result.error.message });
      }
    }

    const allSucceeded = results.every((r) => r.success);
    return res.status(allSucceeded ? 201 : 207).json(results);
  });

  // ─── Mappings CSV Export ────────────────────────────────────────────────────

  /** GET /api/s7/mappings/export/csv - Export all S7 mappings as CSV */
  router.get('/mappings/export/csv', (_req: Request, res: Response) => {
    try {
      if (!database) {
        const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Database not available for export' } };
        return res.status(500).json(errorResponse);
      }

      const db = database.getConnection();
      const mappings = repository.findAllMappings();
      const connections = repository.findAllConnections();

      // Build lookup maps
      const connMap = new Map(connections.map((c) => [c.id, c.name]));

      const nodeRows = db.prepare('SELECT id, name, namespace_id FROM nodes').all() as Array<{ id: string; name: string; namespace_id: string }>;
      const nodeMap = new Map(nodeRows.map((r) => [r.id, r]));

      const nsRows = db.prepare('SELECT id, name FROM namespaces').all() as Array<{ id: string; name: string }>;
      const nsMap = new Map(nsRows.map((r) => [r.id, r.name]));

      // CSV header
      const csvLines: string[] = ['connectionName,plcAddress,nodeName,namespace,description'];

      for (const mapping of mappings) {
        const connName = connMap.get(mapping.connectionId) ?? '';
        const node = nodeMap.get(mapping.nodeId);
        const nodeName = node?.name ?? '';
        const nsName = node ? (nsMap.get(node.namespace_id) ?? '') : '';
        const description = mapping.description ?? '';

        csvLines.push([
          escapeCsvField(connName),
          escapeCsvField(mapping.plcAddress),
          escapeCsvField(nodeName),
          escapeCsvField(nsName),
          escapeCsvField(description),
        ].join(','));
      }

      const csv = csvLines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="s7-mappings.csv"');
      return res.send(csv);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: msg } };
      return res.status(500).json(errorResponse);
    }
  });

  // ─── Mappings CSV Import ────────────────────────────────────────────────────

  /** POST /api/s7/mappings/import/csv - Import S7 mappings from CSV */
  router.post('/mappings/import/csv', (req: Request, res: Response) => {
    try {
      if (!database) {
        const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Database not available for import' } };
        return res.status(500).json(errorResponse);
      }

      const csvContent = req.body?.csv as string | undefined;
      if (!csvContent || typeof csvContent !== 'string') {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'Request body must include a "csv" field with the CSV content as a string' },
        };
        return res.status(400).json(errorResponse);
      }

      const db = database.getConnection();

      // Build lookup maps
      const connections = repository.findAllConnections();
      const connNameToId = new Map(connections.map((c) => [c.name, c.id]));

      const nodeRows = db.prepare('SELECT id, name, namespace_id FROM nodes').all() as Array<{ id: string; name: string; namespace_id: string }>;
      const nsRows = db.prepare('SELECT id, name FROM namespaces').all() as Array<{ id: string; name: string }>;
      const nsNameToId = new Map(nsRows.map((r) => [r.name, r.id]));

      // Parse CSV
      const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'CSV must contain a header row and at least one data row' },
        };
        return res.status(400).json(errorResponse);
      }

      // Validate header
      const header = parseCsvLine(lines[0]);
      const normalizedHeader = header.map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
      if (normalizedHeader.length < 3 || normalizedHeader[0] !== 'connectionname' || normalizedHeader[1] !== 'plcaddress' || normalizedHeader[2] !== 'nodename') {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'CSV header must have columns: connectionName,plcAddress,nodeName,namespace,description' },
        };
        return res.status(400).json(errorResponse);
      }

      const results: Array<{ row: number; success: boolean; plcAddress?: string; error?: string }> = [];

      for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < 3) {
          results.push({ row: i + 1, success: false, error: 'Insufficient columns' });
          continue;
        }

        const [connectionName, plcAddress, nodeName, namespaceName, description] = fields;

        // Resolve connection
        const connectionId = connNameToId.get(connectionName?.trim() ?? '');
        if (!connectionId) {
          results.push({ row: i + 1, success: false, plcAddress, error: `Connection "${connectionName}" not found` });
          continue;
        }

        // Validate PLC address
        if (!plcAddress?.trim()) {
          results.push({ row: i + 1, success: false, error: 'PLC address is required' });
          continue;
        }

        // Resolve node by name (+ namespace if provided)
        if (!nodeName?.trim()) {
          results.push({ row: i + 1, success: false, plcAddress, error: 'Node name is required' });
          continue;
        }

        let matchedNodes = nodeRows.filter((n) => n.name === nodeName.trim());
        if (namespaceName?.trim()) {
          const nsId = nsNameToId.get(namespaceName.trim());
          if (nsId) {
            matchedNodes = matchedNodes.filter((n) => n.namespace_id === nsId);
          }
        }

        if (matchedNodes.length === 0) {
          results.push({ row: i + 1, success: false, plcAddress, error: `Node "${nodeName}" not found${namespaceName ? ` in namespace "${namespaceName}"` : ''}` });
          continue;
        }
        if (matchedNodes.length > 1) {
          results.push({ row: i + 1, success: false, plcAddress, error: `Multiple nodes named "${nodeName}" found — specify the namespace column to disambiguate` });
          continue;
        }

        const nodeId = matchedNodes[0].id;

        // Create mapping
        const result = repository.createMapping({
          connectionId,
          nodeId,
          plcAddress: plcAddress.trim(),
          description: description?.trim() || undefined,
        });

        if (result.success) {
          results.push({ row: i + 1, success: true, plcAddress: plcAddress.trim() });
          // Notify S7 connector
          if (s7Connector && result.data) {
            try { s7Connector.addMapping(result.data); } catch { /* ignore */ }
          }
        } else {
          results.push({ row: i + 1, success: false, plcAddress: plcAddress.trim(), error: result.error.message });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return res.status(failed === 0 ? 201 : 207).json({
        summary: { total: results.length, succeeded, failed },
        results,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: msg } };
      return res.status(500).json(errorResponse);
    }
  });

  // ─── Status Endpoint ────────────────────────────────────────────────────────

  /** GET /api/s7/status - Get connection statuses */
  router.get('/status', (_req: Request, res: Response) => {
    // Use the live S7 Connector status if available
    if (s7Connector) {
      const statuses = s7Connector.getStatus();
      return res.json(statuses);
    }

    // Fallback: report all connections as disconnected when connector is not wired
    const connections = repository.findAllConnections();
    const statuses: S7ConnectionStatus[] = connections.map((conn) => ({
      connectionId: conn.id,
      state: 'disconnected' as const,
    }));
    return res.json(statuses);
  });

  /** GET /api/s7/values - Get current live values for all mapped variables */
  router.get('/values', (_req: Request, res: Response) => {
    if (s7Connector) {
      const values = s7Connector.getCurrentValues();
      return res.json(values);
    }
    return res.json([]);
  });

  /** GET /api/s7/logs - Get S7 connector log entries */
  router.get('/logs', (req: Request, res: Response) => {
    if (!s7Connector) {
      return res.json([]);
    }
    const since = req.query.since as string | undefined;
    const logs = s7Connector.getLogs(since);
    return res.json(logs);
  });

  return router;
}

// ─── CSV Utilities imported from src/utils/csv.ts ───────────────────────────

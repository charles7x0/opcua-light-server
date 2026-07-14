import { Router, Request, Response } from 'express';
import type { ConnectorRepository, CreateConnectionRequest, CreateMappingRequest } from '../../db/repositories/connector-repository.js';
import type { ConnectorRegistry } from '../../connectors/connector-registry.js';
import type { ConnectionConfig, Mapping } from '../../connectors/types.js';
import type { Database } from '../../db/database.js';
import { escapeCsvField, parseCsvLine } from '../../utils/csv.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}

/** S7-specific connection shape (flat host/rack/slot). */
interface S7ConnectionShape {
  id: string;
  name: string;
  host: string;
  rack: number;
  slot: number;
  pollingIntervalMs: number;
  reconnectIntervalMs: number;
  enabled: boolean;
  createdAt: string;
}

/** S7-specific mapping shape (plcAddress instead of deviceAddress). */
interface S7MappingShape {
  id: string;
  connectionId: string;
  nodeId: string | null;
  plcAddress: string;
  description?: string;
  createdAt: string;
}

/**
 * Translate a generalized ConnectionConfig to the legacy S7 flat shape.
 */
function connectionToS7Shape(conn: ConnectionConfig): S7ConnectionShape {
  const params = conn.params as { host: string; rack: number; slot: number };
  return {
    id: conn.id,
    name: conn.name,
    host: params.host,
    rack: params.rack,
    slot: params.slot,
    pollingIntervalMs: conn.pollingIntervalMs,
    reconnectIntervalMs: conn.reconnectIntervalMs,
    enabled: conn.enabled,
    createdAt: conn.createdAt,
  };
}

/**
 * Translate a generalized Mapping to the legacy S7 shape (plcAddress).
 */
function mappingToS7Shape(mapping: Mapping): S7MappingShape {
  return {
    id: mapping.id,
    connectionId: mapping.connectionId,
    nodeId: mapping.nodeId,
    plcAddress: mapping.deviceAddress,
    description: mapping.description,
    createdAt: mapping.createdAt,
  };
}

/**
 * Creates the S7 Alias API router.
 * Translates between the legacy S7 API shape (flat host/rack/slot, plcAddress)
 * and the new generalized connectors format (type + params, deviceAddress).
 *
 * This router calls the ConnectorRepository directly with translations applied.
 */
export function createS7AliasRouter(
  repository: ConnectorRepository,
  registry?: ConnectorRegistry,
  database?: Database
): Router {
  const router = Router();

  // ─── Connection Endpoints ───────────────────────────────────────────────────

  /** POST /api/s7/connections - Create a new S7 connection */
  router.post('/connections', (req: Request, res: Response) => {
    const body = req.body as Partial<{
      name: string;
      host: string;
      rack: number;
      slot: number;
      pollingIntervalMs: number;
      reconnectIntervalMs: number;
      enabled: boolean;
    }>;

    // Validate required fields (S7-specific)
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

    // Translate to generalized format
    const createReq: CreateConnectionRequest = {
      type: 's7',
      name: body.name!,
      params: { host: body.host!, rack: body.rack!, slot: body.slot! },
      pollingIntervalMs: body.pollingIntervalMs,
      reconnectIntervalMs: body.reconnectIntervalMs,
      enabled: body.enabled,
    };

    const result = repository.createConnection(createReq);

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code,
          message: result.error.message,
          details: result.error.details,
        },
      };
      const status = result.error.code === 'DUPLICATE_ERROR' ? 409 : 400;
      return res.status(status).json(errorResponse);
    }

    // Notify the connector registry
    if (registry) {
      try {
        const connector = registry.getConnector('s7');
        if (connector) {
          connector.addConnection(result.data);
        }
      } catch { /* connector may not be registered yet */ }
    }

    return res.status(201).json(connectionToS7Shape(result.data));
  });

  /** GET /api/s7/connections - List all S7 connections */
  router.get('/connections', (_req: Request, res: Response) => {
    const connections = repository.findAllConnections('s7');
    return res.json(connections.map(connectionToS7Shape));
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

    // Build the params object for generalized update (merge with existing if partial)
    const existing = repository.findConnectionById(id);
    if (!existing) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: `Connection with id "${id}" not found`,
        },
      };
      return res.status(404).json(errorResponse);
    }

    // Translate S7 flat fields to generalized params
    const existingParams = existing.params as { host: string; rack: number; slot: number };
    const hasParamChanges = body.host !== undefined || body.rack !== undefined || body.slot !== undefined;

    const updateReq: {
      name?: string;
      params?: Record<string, unknown>;
      pollingIntervalMs?: number;
      reconnectIntervalMs?: number;
      enabled?: boolean;
    } = {};

    if (body.name !== undefined) updateReq.name = body.name;
    if (body.pollingIntervalMs !== undefined) updateReq.pollingIntervalMs = body.pollingIntervalMs;
    if (body.reconnectIntervalMs !== undefined) updateReq.reconnectIntervalMs = body.reconnectIntervalMs;
    if (body.enabled !== undefined) updateReq.enabled = body.enabled;

    if (hasParamChanges) {
      updateReq.params = {
        host: body.host ?? existingParams.host,
        rack: body.rack ?? existingParams.rack,
        slot: body.slot ?? existingParams.slot,
      };
    }

    const result = repository.updateConnection(id, updateReq);

    if (!result.success) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 400;
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };
      return res.status(statusCode).json(errorResponse);
    }

    // Notify the connector registry
    if (registry) {
      try {
        const connector = registry.getConnector('s7');
        if (connector) {
          connector.updateConnection(result.data);
        }
      } catch { /* connector may not be tracking this connection yet */ }
    }

    return res.status(200).json(connectionToS7Shape(result.data));
  });

  /** DELETE /api/s7/connections/:id - Delete an S7 connection */
  router.delete('/connections/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;

    // Look up connection before deletion for connector notification
    const connection = repository.findConnectionById(id);
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

    // Notify the connector to clean up resources
    if (registry && connection) {
      try {
        const connector = registry.getConnector('s7');
        if (connector) {
          connector.removeConnection(id);
        }
      } catch { /* may not exist in connector */ }
    }

    return res.status(204).send();
  });

  // ─── Mapping Endpoints ──────────────────────────────────────────────────────

  /** POST /api/s7/mappings - Create a new S7 mapping */
  router.post('/mappings', (req: Request, res: Response) => {
    const body = req.body as Partial<{
      connectionId: string;
      nodeId: string;
      plcAddress: string;
      description: string;
    }>;

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

    // Translate plcAddress → deviceAddress
    const createReq: CreateMappingRequest = {
      connectionId: body.connectionId!,
      nodeId: body.nodeId!,
      deviceAddress: body.plcAddress!,
      description: body.description,
    };

    const result = repository.createMapping(createReq);

    if (!result.success) {
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code,
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

    // Notify the connector
    if (registry && result.data) {
      try {
        const connector = registry.getConnector('s7');
        if (connector) {
          connector.addMapping(result.data);
        }
      } catch { /* connector may not have the connection tracked yet */ }
    }

    return res.status(201).json(mappingToS7Shape(result.data));
  });

  /** GET /api/s7/mappings - List all S7 mappings (optional ?connectionId= filter) */
  router.get('/mappings', (req: Request, res: Response) => {
    const connectionId = req.query.connectionId as string | undefined;
    const mappings = repository.findAllMappings(connectionId);
    return res.json(mappings.map(mappingToS7Shape));
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

    // Translate plcAddress → deviceAddress
    const updateReq: { deviceAddress?: string; nodeId?: string; description?: string } = {};
    if (body.plcAddress !== undefined) updateReq.deviceAddress = body.plcAddress;
    if (body.nodeId !== undefined) updateReq.nodeId = body.nodeId;
    if (body.description !== undefined) updateReq.description = body.description;

    const result = repository.updateMapping(id, updateReq);

    if (!result.success) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'DUPLICATE_ERROR' ? 409 : 400;
      const errorResponse: ErrorResponse = {
        error: {
          code: result.error.code,
          message: result.error.message,
          details: result.error.details,
        },
      };
      return res.status(statusCode).json(errorResponse);
    }

    return res.status(200).json(mappingToS7Shape(result.data));
  });

  /** DELETE /api/s7/mappings/:id - Delete an S7 mapping */
  router.delete('/mappings/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;

    // Look up mapping before deletion for connector notification
    const mapping = repository.findMappingById(id);
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

    // Notify the connector to stop polling this address
    if (registry && mapping) {
      try {
        const connector = registry.getConnector('s7');
        if (connector) {
          connector.removeMapping(id);
        }
      } catch { /* may not exist in connector */ }
    }

    return res.status(204).send();
  });

  /** POST /api/s7/mappings/bulk - Create multiple S7 mappings at once */
  router.post('/mappings/bulk', (req: Request, res: Response) => {
    const body = req.body as Array<Partial<{ connectionId: string; nodeId: string; plcAddress: string; description: string }>>;

    if (!Array.isArray(body) || body.length === 0) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body must be a non-empty array of mappings',
        },
      };
      return res.status(400).json(errorResponse);
    }

    const results: { index: number; success: boolean; data?: S7MappingShape; error?: string }[] = [];

    for (let i = 0; i < body.length; i++) {
      const item = body[i];
      if (!item.connectionId || !item.nodeId || !item.plcAddress) {
        results.push({ index: i, success: false, error: 'Missing required fields (connectionId, nodeId, plcAddress)' });
        continue;
      }

      const result = repository.createMapping({
        connectionId: item.connectionId,
        nodeId: item.nodeId,
        deviceAddress: item.plcAddress,
        description: item.description,
      });

      if (result.success) {
        results.push({ index: i, success: true, data: mappingToS7Shape(result.data) });
        // Notify the connector
        if (registry && result.data) {
          try {
            const connector = registry.getConnector('s7');
            if (connector) {
              connector.addMapping(result.data);
            }
          } catch { /* ignore */ }
        }
      } else {
        results.push({ index: i, success: false, error: result.error.message });
      }
    }

    const allSucceeded = results.every((r) => r.success);
    return res.status(allSucceeded ? 201 : 207).json(results);
  });

  // ─── Mappings CSV Export ────────────────────────────────────────────────────

  /** GET /api/s7/mappings/export/csv - Export S7 mappings as CSV (uses plcAddress column) */
  router.get('/mappings/export/csv', (_req: Request, res: Response) => {
    try {
      if (!database) {
        const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Database not available for export' } };
        return res.status(500).json(errorResponse);
      }

      const db = database.getConnection();

      // Only get S7 connections
      const connections = repository.findAllConnections('s7');
      const connIds = new Set(connections.map((c) => c.id));
      const connMap = new Map(connections.map((c) => [c.id, c.name]));

      // Get mappings for S7 connections only
      const allMappings = repository.findAllMappings();
      const mappings = allMappings.filter((m) => connIds.has(m.connectionId));

      const nodeRows = db.prepare('SELECT id, name, namespace_id FROM nodes').all() as Array<{ id: string; name: string; namespace_id: string }>;
      const nodeMap = new Map(nodeRows.map((r) => [r.id, r]));

      const nsRows = db.prepare('SELECT id, name FROM namespaces').all() as Array<{ id: string; name: string }>;
      const nsMap = new Map(nsRows.map((r) => [r.id, r.name]));

      // CSV header uses plcAddress (S7-specific naming)
      const csvLines: string[] = ['connectionName,plcAddress,nodeName,namespace,description'];

      for (const mapping of mappings) {
        const connName = connMap.get(mapping.connectionId) ?? '';
        const node = mapping.nodeId ? nodeMap.get(mapping.nodeId) : undefined;
        const nodeName = node?.name ?? '';
        const nsName = node ? (nsMap.get(node.namespace_id) ?? '') : '';
        const description = mapping.description ?? '';

        csvLines.push([
          escapeCsvField(connName),
          escapeCsvField(mapping.deviceAddress),
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

  /** POST /api/s7/mappings/import/csv - Import S7 mappings from CSV (accepts plcAddress column) */
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

      // Build lookup maps (only S7 connections)
      const connections = repository.findAllConnections('s7');
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

      // Validate header (expects: connectionName,plcAddress,nodeName,namespace,description)
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

        // Resolve connection by name
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

        // Create mapping (translate plcAddress → deviceAddress)
        const result = repository.createMapping({
          connectionId,
          nodeId,
          deviceAddress: plcAddress.trim(),
          description: description?.trim() || undefined,
        });

        if (result.success) {
          results.push({ row: i + 1, success: true, plcAddress: plcAddress.trim() });
          // Notify connector
          if (registry) {
            try {
              const connector = registry.getConnector('s7');
              if (connector) {
                connector.addMapping(result.data);
              }
            } catch { /* ignore */ }
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

  /** GET /api/s7/status - Get S7 connection statuses */
  router.get('/status', (_req: Request, res: Response) => {
    if (registry) {
      const connector = registry.getConnector('s7');
      if (connector) {
        return res.json(connector.getStatus());
      }
    }

    // Fallback: report all S7 connections as disconnected
    const connections = repository.findAllConnections('s7');
    const statuses = connections.map((conn) => ({
      connectionId: conn.id,
      state: 'disconnected' as const,
    }));
    return res.json(statuses);
  });

  // ─── Values Endpoint ────────────────────────────────────────────────────────

  /** GET /api/s7/values - Get current live values (translate deviceAddress → plcAddress) */
  router.get('/values', (_req: Request, res: Response) => {
    if (registry) {
      const connector = registry.getConnector('s7');
      if (connector) {
        const values = connector.getCurrentValues();
        // Translate deviceAddress → plcAddress in response
        const translated = values.map((v) => ({
          nodeId: v.nodeId,
          plcAddress: v.deviceAddress,
          connectionId: v.connectionId,
          value: v.value,
          quality: v.quality,
          timestamp: v.timestamp,
        }));
        return res.json(translated);
      }
    }
    return res.json([]);
  });

  // ─── Logs Endpoint ──────────────────────────────────────────────────────────

  /** GET /api/s7/logs - Get S7 connector logs */
  router.get('/logs', (req: Request, res: Response) => {
    if (registry) {
      const connector = registry.getConnector('s7');
      if (connector && 'getLogs' in connector) {
        const since = req.query.since as string | undefined;
        const logs = (connector as { getLogs: (since?: string) => unknown[] }).getLogs(since);
        return res.json(logs);
      }
    }
    return res.json([]);
  });

  return router;
}

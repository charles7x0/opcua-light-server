import { Router, Request, Response } from 'express';
import type { ConnectorRepository, CreateConnectionRequest, CreateMappingRequest } from '../../db/repositories/connector-repository.js';
import type { ConnectorRegistry } from '../../connectors/connector-registry.js';
import type { Database } from '../../db/database.js';
import { escapeCsvField, parseCsvLine } from '../../utils/csv.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}

/**
 * Creates the generalized Connectors API router.
 * Provides CRUD for connections (any protocol type), CRUD for mappings,
 * aggregated status/values, bulk operations, and CSV import/export.
 *
 * @param repository - ConnectorRepository for persistence operations
 * @param registry - Optional ConnectorRegistry for real-time status, values, and connector notifications
 * @param database - Optional Database instance required for CSV export/import (node/namespace lookups)
 */
export function createConnectorsRouter(
  repository: ConnectorRepository,
  registry?: ConnectorRegistry,
  database?: Database
): Router {
  const router = Router();

  // ─── Connection Endpoints ───────────────────────────────────────────────────

  /** POST /api/connectors/connections - Create a new connection */
  router.post('/connections', (req: Request, res: Response) => {
    const body = req.body as Partial<CreateConnectionRequest>;

    // Validate required fields
    const errors: { field: string; message: string }[] = [];
    if (!body.type || typeof body.type !== 'string' || body.type.trim() === '') {
      errors.push({ field: 'type', message: 'Type is required' });
    }
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push({ field: 'name', message: 'Name is required' });
    }
    if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) {
      errors.push({ field: 'params', message: 'Params is required and must be an object' });
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

    const result = repository.createConnection(body as CreateConnectionRequest);

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

    // Notify the connector registry about the new connection
    if (registry) {
      try {
        const connector = registry.getConnector(result.data.type);
        if (connector) {
          connector.addConnection(result.data);
        }
      } catch { /* connector may not be registered yet */ }
    }

    return res.status(201).json(result.data);
  });

  /** GET /api/connectors/connections - List all connections (optional ?type= filter) */
  router.get('/connections', (req: Request, res: Response) => {
    const type = req.query.type as string | undefined;
    const connections = repository.findAllConnections(type);
    return res.json(connections);
  });

  /** PUT /api/connectors/connections/:id - Update a connection */
  router.put('/connections/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const body = req.body as Partial<{
      name: string;
      params: Record<string, unknown>;
      pollingIntervalMs: number;
      reconnectIntervalMs: number;
      enabled: boolean;
    }>;

    // Validate at least one field is provided
    if (!body.name && !body.params && body.pollingIntervalMs === undefined &&
        body.reconnectIntervalMs === undefined && body.enabled === undefined) {
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
          code: result.error.code,
          message: result.error.message,
        },
      };
      return res.status(statusCode).json(errorResponse);
    }

    // Notify the connector registry about the config change
    if (registry) {
      try {
        const connector = registry.getConnector(result.data.type);
        if (connector) {
          connector.updateConnection(result.data);
        }
      } catch { /* connector may not be tracking this connection yet */ }
    }

    return res.status(200).json(result.data);
  });

  /** DELETE /api/connectors/connections/:id - Delete a connection (cascades mappings) */
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
        const connector = registry.getConnector(connection.type);
        if (connector) {
          connector.removeConnection(id);
        }
      } catch { /* may not exist in connector */ }
    }

    return res.status(204).send();
  });

  // ─── Mapping Endpoints ──────────────────────────────────────────────────────

  /**
   * POST /api/connectors/mappings - Create a new mapping.
   * Required fields: connectionId, deviceAddress.
   * Optional fields: nodeId (links mapping to an OPC UA node), description.
   */
  router.post('/mappings', (req: Request, res: Response) => {
    const body = req.body as Partial<CreateMappingRequest>;

    // Validate required fields
    const errors: { field: string; message: string }[] = [];
    if (!body.connectionId || typeof body.connectionId !== 'string' || body.connectionId.trim() === '') {
      errors.push({ field: 'connectionId', message: 'Connection ID is required' });
    }
    if (body.nodeId !== undefined && body.nodeId !== null && (typeof body.nodeId !== 'string' || body.nodeId.trim() === '')) {
      errors.push({ field: 'nodeId', message: 'Node ID must be a non-empty string when provided' });
    }
    if (!body.deviceAddress || typeof body.deviceAddress !== 'string' || body.deviceAddress.trim() === '') {
      errors.push({ field: 'deviceAddress', message: 'Device address is required' });
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

    const result = repository.createMapping(body as CreateMappingRequest);

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

    // Notify the connector so it starts polling this address
    if (registry && result.data) {
      try {
        const connection = repository.findConnectionById(result.data.connectionId);
        if (connection) {
          const connector = registry.getConnector(connection.type);
          if (connector) {
            connector.addMapping(result.data);
          }
        }
      } catch { /* connector may not have the connection tracked yet */ }
    }

    return res.status(201).json(result.data);
  });

  /** GET /api/connectors/mappings - List all mappings (optional ?connectionId= filter) */
  router.get('/mappings', (req: Request, res: Response) => {
    const connectionId = req.query.connectionId as string | undefined;
    const mappings = repository.findAllMappings(connectionId);
    return res.json(mappings);
  });

  /** PUT /api/connectors/mappings/:id - Update a mapping */
  router.put('/mappings/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const body = req.body as Partial<{ deviceAddress: string; nodeId: string; description: string }>;

    if (!body.deviceAddress && !body.nodeId && body.description === undefined) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one field (deviceAddress, nodeId, or description) must be provided',
        },
      };
      return res.status(400).json(errorResponse);
    }

    const result = repository.updateMapping(id, body);

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

    return res.status(200).json(result.data);
  });

  /** DELETE /api/connectors/mappings/:id - Delete a mapping */
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
        const connection = repository.findConnectionById(mapping.connectionId);
        if (connection) {
          const connector = registry.getConnector(connection.type);
          if (connector) {
            connector.removeMapping(id);
          }
        }
      } catch { /* may not exist in connector */ }
    }

    return res.status(204).send();
  });

  /** POST /api/connectors/mappings/bulk - Create multiple mappings at once */
  router.post('/mappings/bulk', (req: Request, res: Response) => {
    const body = req.body as Array<Partial<CreateMappingRequest>>;

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
      if (!item.connectionId || !item.deviceAddress) {
        results.push({ index: i, success: false, error: 'Missing required fields (connectionId, deviceAddress)' });
        continue;
      }

      const result = repository.createMapping({
        connectionId: item.connectionId,
        nodeId: item.nodeId,
        deviceAddress: item.deviceAddress,
        description: item.description,
      });

      if (result.success) {
        results.push({ index: i, success: true, data: result.data });
        // Notify the connector
        if (registry && result.data) {
          try {
            const connection = repository.findConnectionById(result.data.connectionId);
            if (connection) {
              const connector = registry.getConnector(connection.type);
              if (connector) {
                connector.addMapping(result.data);
              }
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

  /** GET /api/connectors/mappings/export/csv - Export all mappings as CSV */
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
      const connMap = new Map(connections.map((c) => [c.id, c]));

      const nodeRows = db.prepare('SELECT id, name, namespace_id FROM nodes').all() as Array<{ id: string; name: string; namespace_id: string }>;
      const nodeMap = new Map(nodeRows.map((r) => [r.id, r]));

      const nsRows = db.prepare('SELECT id, name FROM namespaces').all() as Array<{ id: string; name: string }>;
      const nsMap = new Map(nsRows.map((r) => [r.id, r.name]));

      // CSV header
      const csvLines: string[] = ['connectionName,type,deviceAddress,nodeName,namespace,description'];

      for (const mapping of mappings) {
        const conn = connMap.get(mapping.connectionId);
        const connName = conn?.name ?? '';
        const connType = conn?.type ?? '';
        const node = mapping.nodeId ? nodeMap.get(mapping.nodeId) : undefined;
        const nodeName = node?.name ?? '';
        const nsName = node ? (nsMap.get(node.namespace_id) ?? '') : '';
        const description = mapping.description ?? '';

        csvLines.push([
          escapeCsvField(connName),
          escapeCsvField(connType),
          escapeCsvField(mapping.deviceAddress),
          escapeCsvField(nodeName),
          escapeCsvField(nsName),
          escapeCsvField(description),
        ].join(','));
      }

      const csv = csvLines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="connectors-mappings.csv"');
      return res.send(csv);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: msg } };
      return res.status(500).json(errorResponse);
    }
  });

  // ─── Mappings CSV Import ────────────────────────────────────────────────────

  /** POST /api/connectors/mappings/import/csv - Import mappings from CSV */
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
      if (normalizedHeader.length < 3 || normalizedHeader[0] !== 'connectionname' ||
          (normalizedHeader[1] !== 'type' && normalizedHeader[1] !== 'deviceaddress')) {
        const errorResponse: ErrorResponse = {
          error: { code: 'VALIDATION_ERROR', message: 'CSV header must have columns: connectionName,type,deviceAddress,nodeName,namespace,description' },
        };
        return res.status(400).json(errorResponse);
      }

      // Determine column layout: with or without type column
      // Expected: connectionName,type,deviceAddress,nodeName,namespace,description
      // The type column is optional/informational — connectionName determines the connection
      const hasTypeColumn = normalizedHeader[1] === 'type';
      const deviceAddressIdx = hasTypeColumn ? 2 : 1;
      const nodeNameIdx = hasTypeColumn ? 3 : 2;
      const namespaceIdx = hasTypeColumn ? 4 : 3;
      const descriptionIdx = hasTypeColumn ? 5 : 4;

      const results: Array<{ row: number; success: boolean; deviceAddress?: string; error?: string }> = [];

      for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < deviceAddressIdx + 2) {
          results.push({ row: i + 1, success: false, error: 'Insufficient columns' });
          continue;
        }

        const connectionName = fields[0];
        const deviceAddress = fields[deviceAddressIdx];
        const nodeName = fields[nodeNameIdx];
        const namespaceName = fields[namespaceIdx];
        const description = fields[descriptionIdx];

        // Resolve connection by name
        const connectionId = connNameToId.get(connectionName?.trim() ?? '');
        if (!connectionId) {
          results.push({ row: i + 1, success: false, deviceAddress, error: `Connection "${connectionName}" not found` });
          continue;
        }

        // Validate device address
        if (!deviceAddress?.trim()) {
          results.push({ row: i + 1, success: false, error: 'Device address is required' });
          continue;
        }

        // Resolve node by name (+ namespace if provided)
        if (!nodeName?.trim()) {
          results.push({ row: i + 1, success: false, deviceAddress, error: 'Node name is required' });
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
          results.push({ row: i + 1, success: false, deviceAddress, error: `Node "${nodeName}" not found${namespaceName ? ` in namespace "${namespaceName}"` : ''}` });
          continue;
        }
        if (matchedNodes.length > 1) {
          results.push({ row: i + 1, success: false, deviceAddress, error: `Multiple nodes named "${nodeName}" found — specify the namespace column to disambiguate` });
          continue;
        }

        const nodeId = matchedNodes[0].id;

        // Create mapping
        const result = repository.createMapping({
          connectionId,
          nodeId,
          deviceAddress: deviceAddress.trim(),
          description: description?.trim() || undefined,
        });

        if (result.success) {
          results.push({ row: i + 1, success: true, deviceAddress: deviceAddress.trim() });
          // Notify connector
          if (registry && result.data) {
            try {
              const connection = repository.findConnectionById(result.data.connectionId);
              if (connection) {
                const connector = registry.getConnector(connection.type);
                if (connector) {
                  connector.addMapping(result.data);
                }
              }
            } catch { /* ignore */ }
          }
        } else {
          results.push({ row: i + 1, success: false, deviceAddress: deviceAddress.trim(), error: result.error.message });
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

  /** GET /api/connectors/status - Get aggregated connection statuses */
  router.get('/status', (_req: Request, res: Response) => {
    // Use the registry's aggregated status if available
    if (registry) {
      const statuses = registry.getAggregatedStatus();
      return res.json(statuses);
    }

    // Fallback: report all connections as disconnected when registry is not wired
    const connections = repository.findAllConnections();
    const statuses = connections.map((conn) => ({
      connectionId: conn.id,
      state: 'disconnected' as const,
    }));
    return res.json(statuses);
  });

  /** GET /api/connectors/values - Get current live values for all mapped variables */
  router.get('/values', (_req: Request, res: Response) => {
    if (registry) {
      const values = registry.getAggregatedValues();
      return res.json(values);
    }
    return res.json([]);
  });

  return router;
}

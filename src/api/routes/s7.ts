import { Router, Request, Response } from 'express';
import type { S7Repository } from '../../db/repositories/s7-repository.js';
import type { S7Connector } from '../../s7-connector/index.js';
import type {
  CreateS7ConnectionRequest,
  CreateS7MappingRequest,
  ErrorResponse,
} from '../../types/api.js';
import type { S7ConnectionStatus } from '../../types/index.js';

/**
 * Creates the S7 Connector API router.
 * Provides CRUD for connections, CRUD for mappings, and connection status.
 */
export function createS7Router(repository: S7Repository, s7Connector?: S7Connector): Router {
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

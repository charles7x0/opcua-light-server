import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import { ConnectorRegistry } from '../../src/connectors/core/connector-registry.js';
import { createConnectorsRouter } from '../../src/api/routes/connectors.js';
import type { ConnectorMetadata, ConnectionConfig, Mapping, ConnectionStatus, CurrentValue, ValueUpdateCallback, Connector } from '../../src/connectors/core/types.js';
import type { ConnectorRepository, CreateConnectionRequest, CreateMappingRequest } from '../../src/db/repositories/connector-repository.js';

// ─── Mock Connector ───────────────────────────────────────────────────────────

function createMockConnector(type: string): Connector {
  return {
    getType: () => type,
    start: () => {},
    stop: () => {},
    addConnection: () => {},
    removeConnection: () => {},
    updateConnection: () => {},
    addMapping: () => {},
    removeMapping: () => {},
    getStatus: () => [],
    getCurrentValues: () => [],
    onValueUpdate: () => {},
  };
}

// ─── Mock Repository ──────────────────────────────────────────────────────────

function createMockRepository(): ConnectorRepository {
  const connections = new Map<string, ConnectionConfig>();

  return {
    createConnection(req: CreateConnectionRequest) {
      const config: ConnectionConfig = {
        id: `conn-${Date.now()}`,
        type: req.type,
        name: req.name,
        params: req.params,
        pollingIntervalMs: req.pollingIntervalMs ?? 1000,
        reconnectIntervalMs: req.reconnectIntervalMs ?? 5000,
        enabled: req.enabled ?? true,
        createdAt: new Date().toISOString(),
      };
      connections.set(config.id, config);
      return { success: true as const, data: config };
    },
    updateConnection(id: string, updates: Partial<ConnectionConfig>) {
      const existing = connections.get(id);
      if (!existing) {
        return { success: false as const, error: { code: 'NOT_FOUND', message: 'Connection not found' } };
      }
      const updated = { ...existing, ...updates };
      connections.set(id, updated);
      return { success: true as const, data: updated };
    },
    findConnectionById(id: string) {
      return connections.get(id) ?? null;
    },
    findAllConnections() {
      return Array.from(connections.values());
    },
    deleteConnection(id: string) {
      if (!connections.has(id)) {
        return { success: false as const, error: { code: 'NOT_FOUND', message: 'Connection not found' } };
      }
      connections.delete(id);
      return { success: true as const, data: undefined };
    },
    createMapping() {
      return { success: true as const, data: { id: 'map-1', connectionId: '', nodeId: null, deviceAddress: '', createdAt: '' } as Mapping };
    },
    findAllMappings() { return []; },
    findMappingById() { return null; },
    updateMapping() { return { success: true as const, data: {} as Mapping }; },
    deleteMapping() { return { success: true as const, data: undefined }; },
  } as unknown as ConnectorRepository;
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function createTestApp(repository: ConnectorRepository, registry?: ConnectorRegistry): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/connectors', createConnectorsRouter(repository, registry));
  return app;
}

/** Simulates an HTTP request by calling the Express app directly. */
async function request(
  app: Express,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const req = {
      method,
      url: path,
      headers: { 'content-type': 'application/json' } as Record<string, string>,
      body: body ?? {},
      query: {} as Record<string, string>,
      params: {} as Record<string, string>,
    };

    // Parse query params from URL
    const [urlPath, queryString] = path.split('?');
    req.url = urlPath;
    if (queryString) {
      for (const pair of queryString.split('&')) {
        const [key, value] = pair.split('=');
        req.query[key] = decodeURIComponent(value);
      }
    }

    let statusCode = 200;
    let responseBody: unknown = null;
    let headersSent = false;
    const responseHeaders: Record<string, string> = {};

    const res = {
      statusCode: 200,
      status(code: number) {
        statusCode = code;
        res.statusCode = code;
        return res;
      },
      json(data: unknown) {
        responseBody = data;
        headersSent = true;
        resolve({ status: statusCode, body: responseBody, headers: responseHeaders });
        return res;
      },
      send(data?: unknown) {
        if (!headersSent) {
          responseBody = data ?? null;
          headersSent = true;
          resolve({ status: statusCode, body: responseBody, headers: responseHeaders });
        }
        return res;
      },
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return res;
      },
      getHeader() { return undefined; },
      end() {
        if (!headersSent) {
          headersSent = true;
          resolve({ status: statusCode, body: responseBody, headers: responseHeaders });
        }
      },
    };

    app(req as any, res as any);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Connectors Protocols Route and Validation Integration', () => {
  let registry: ConnectorRegistry;
  let repo: ConnectorRepository;
  let app: Express;

  beforeEach(() => {
    registry = new ConnectorRegistry();
    repo = createMockRepository();
  });

  describe('GET /api/connectors/protocols', () => {
    it('should return correct shape with registered connectors', async () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata: ConnectorMetadata = {
        type: 's7',
        displayName: 'Siemens S7',
        paramsSchema: [
          { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
          { key: 'rack', label: 'Rack', type: 'number', required: false, defaultValue: 0, min: 0 },
        ],
      };

      const modbusConnector = createMockConnector('modbus-tcp');
      const modbusMetadata: ConnectorMetadata = {
        type: 'modbus-tcp',
        displayName: 'Modbus TCP',
        paramsSchema: [
          { key: 'host', label: 'Host', type: 'text', required: true },
          { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: 502 },
        ],
      };

      registry.register(s7Connector, s7Metadata);
      registry.register(modbusConnector, modbusMetadata);

      app = createTestApp(repo, registry);

      const res = await request(app, 'GET', '/api/connectors/protocols');

      expect(res.status).toBe(200);
      const data = res.body as ConnectorMetadata[];
      expect(data).toHaveLength(2);

      // Each entry has type, displayName, and paramsSchema
      for (const protocol of data) {
        expect(protocol).toHaveProperty('type');
        expect(protocol).toHaveProperty('displayName');
        expect(protocol).toHaveProperty('paramsSchema');
        expect(Array.isArray(protocol.paramsSchema)).toBe(true);
        expect(protocol.paramsSchema.length).toBeGreaterThan(0);
      }

      // Verify specific data
      const s7 = data.find((p) => p.type === 's7');
      expect(s7).toBeDefined();
      expect(s7!.displayName).toBe('Siemens S7');

      const modbus = data.find((p) => p.type === 'modbus-tcp');
      expect(modbus).toBeDefined();
      expect(modbus!.displayName).toBe('Modbus TCP');
    });

    it('should return empty array when no connectors are registered', async () => {
      app = createTestApp(repo, registry);

      const res = await request(app, 'GET', '/api/connectors/protocols');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/connectors/connections with invalid params', () => {
    it('should return 400 with per-field errors when required params are missing', async () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata: ConnectorMetadata = {
        type: 's7',
        displayName: 'Siemens S7',
        paramsSchema: [
          { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
          { key: 'rack', label: 'Rack', type: 'number', required: false, defaultValue: 0, min: 0 },
        ],
      };
      registry.register(s7Connector, s7Metadata);
      app = createTestApp(repo, registry);

      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        name: 'Test',
        params: {},
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.details).toBeDefined();
      expect(Array.isArray(data.error.details)).toBe(true);

      // Should contain a 'host' field error
      const hostError = data.error.details.find((d: any) => d.field === 'host');
      expect(hostError).toBeDefined();
      expect(hostError.message).toContain('required');
    });
  });

  describe('POST /api/connectors/connections with valid params', () => {
    it('should return 201 when params pass validation', async () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata: ConnectorMetadata = {
        type: 's7',
        displayName: 'Siemens S7',
        paramsSchema: [
          { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
          { key: 'rack', label: 'Rack', type: 'number', required: false, defaultValue: 0, min: 0 },
          { key: 'slot', label: 'Slot', type: 'number', required: false, defaultValue: 1, min: 0 },
        ],
      };
      registry.register(s7Connector, s7Metadata);
      app = createTestApp(repo, registry);

      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        name: 'Test',
        params: { host: '192.168.1.1' },
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.type).toBe('s7');
      expect(data.name).toBe('Test');
      expect(data.params.host).toBe('192.168.1.1');
    });
  });

  describe('PUT /api/connectors/connections/:id with invalid params', () => {
    it('should return 400 when updating params to invalid values', async () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata: ConnectorMetadata = {
        type: 's7',
        displayName: 'Siemens S7',
        paramsSchema: [
          { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
          { key: 'port', label: 'Port', type: 'number', required: true, min: 1, max: 65535 },
        ],
      };
      registry.register(s7Connector, s7Metadata);
      app = createTestApp(repo, registry);

      // First, create a valid connection
      const createRes = await request(app, 'POST', '/api/connectors/connections', {
        type: 's7',
        name: 'Test PLC',
        params: { host: '192.168.1.1', port: 102 },
      });
      expect(createRes.status).toBe(201);
      const connectionId = (createRes.body as any).id;

      // Now update with invalid params (missing required 'host', port out of range)
      const res = await request(app, 'PUT', `/api/connectors/connections/${connectionId}`, {
        params: { host: '', port: 99999 },
      });

      expect(res.status).toBe(400);
      const data = res.body as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.details).toBeDefined();
      expect(Array.isArray(data.error.details)).toBe(true);
      expect(data.error.details.length).toBeGreaterThan(0);
    });
  });

  describe('Unknown protocol type skips validation', () => {
    it('should succeed when protocol type has no registered schema', async () => {
      // Register only s7 — 'custom-new' has no schema
      const s7Connector = createMockConnector('s7');
      const s7Metadata: ConnectorMetadata = {
        type: 's7',
        displayName: 'Siemens S7',
        paramsSchema: [
          { key: 'host', label: 'Host', type: 'text', required: true },
        ],
      };
      registry.register(s7Connector, s7Metadata);
      app = createTestApp(repo, registry);

      // POST with an unregistered protocol type — should skip validation and succeed
      const res = await request(app, 'POST', '/api/connectors/connections', {
        type: 'custom-new',
        name: 'Test',
        params: { anything: 'goes' },
      });

      expect(res.status).toBe(201);
      const data = res.body as any;
      expect(data.type).toBe('custom-new');
      expect(data.name).toBe('Test');
      expect(data.params.anything).toBe('goes');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventsRouter } from '../../src/api/routes/events.js';
import type { Request, Response } from 'express';
import type { SseHub } from '../../src/api/sse-hub.js';
import type { ProcessManager } from '../../src/process-manager/index.js';
import type { ConnectorRegistry } from '../../src/connectors/core/connector-registry.js';

/** Creates a mock Express Request with event emitter capabilities. */
function createMockRequest(): Request {
  const listeners: Record<string, Function[]> = {};
  return {
    on(event: string, handler: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
      return this;
    },
    emit(event: string) {
      (listeners[event] || []).forEach((fn) => fn());
    },
  } as unknown as Request;
}

/** Creates a mock Express Response with SSE-relevant methods. */
function createMockResponse(): Response {
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
  } as unknown as Response;
}

/** Creates a mock SseHub. */
function createMockSseHub(): SseHub {
  return {
    addClient: vi.fn(),
    removeClient: vi.fn(),
    sendToClient: vi.fn(),
    broadcast: vi.fn(),
    startHeartbeat: vi.fn(),
    shutdown: vi.fn(),
    getClientCount: vi.fn().mockReturnValue(0),
  } as unknown as SseHub;
}

/** Creates a mock ProcessManager. */
function createMockProcessManager(): ProcessManager {
  return {
    getStatus: vi.fn().mockReturnValue({ state: 'stopped', uptime: 0, pid: null, connectedClients: 0, lastError: null }),
    readClientSessions: vi.fn().mockReturnValue([]),
  } as unknown as ProcessManager;
}

/** Creates a mock ConnectorRegistry. */
function createMockConnectorRegistry(): ConnectorRegistry {
  return {
    getAggregatedStatus: vi.fn().mockReturnValue([]),
    getAggregatedValues: vi.fn().mockReturnValue([]),
  } as unknown as ConnectorRegistry;
}

describe('Events Route', () => {
  let sseHub: SseHub;
  let processManager: ProcessManager;
  let connectorRegistry: ConnectorRegistry;
  let req: Request;
  let res: Response;

  beforeEach(() => {
    sseHub = createMockSseHub();
    processManager = createMockProcessManager();
    connectorRegistry = createMockConnectorRegistry();
    req = createMockRequest();
    res = createMockResponse();
  });

  /** Invokes the GET / handler on the events router. */
  function invokeHandler(): void {
    const router = createEventsRouter({ sseHub, processManager, connectorRegistry });
    // Extract the route handler registered for GET /
    const layer = (router as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get,
    );
    const handler = layer.route.stack[0].handle;
    handler(req, res);
  }

  describe('response headers', () => {
    it('should set Content-Type to text/event-stream', () => {
      invokeHandler();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('should set Cache-Control to no-cache', () => {
      invokeHandler();
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    });

    it('should set Connection to keep-alive', () => {
      invokeHandler();
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });

    it('should call flushHeaders to disable response buffering', () => {
      invokeHandler();
      expect(res.flushHeaders).toHaveBeenCalled();
    });
  });

  describe('client registration', () => {
    it('should register client with SseHub using a UUID and the response', () => {
      invokeHandler();

      expect(sseHub.addClient).toHaveBeenCalledTimes(1);
      const [clientId, clientRes] = (sseHub.addClient as ReturnType<typeof vi.fn>).mock.calls[0];
      // Client ID should be a valid UUID v4 format
      expect(clientId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(clientRes).toBe(res);
    });
  });

  describe('client disconnect', () => {
    it('should call sseHub.removeClient when request emits close', () => {
      invokeHandler();

      const [clientId] = (sseHub.addClient as ReturnType<typeof vi.fn>).mock.calls[0];

      // Simulate disconnect
      (req as any).emit('close');

      expect(sseHub.removeClient).toHaveBeenCalledWith(clientId);
    });
  });

  describe('initial state events', () => {
    it('should send server:status event with process manager status', () => {
      const status = { state: 'running', uptime: 120, pid: 1234, connectedClients: 2, lastError: null };
      (processManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue(status);

      invokeHandler();

      const [clientId] = (sseHub.addClient as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sseHub.sendToClient).toHaveBeenCalledWith(clientId, 'server:status', status);
    });

    it('should send server:clients event with client sessions', () => {
      const sessions = [{ applicationName: 'UaExpert', applicationUri: 'urn:UA:UaExpert' }];
      (processManager.readClientSessions as ReturnType<typeof vi.fn>).mockReturnValue(sessions);

      invokeHandler();

      const [clientId] = (sseHub.addClient as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sseHub.sendToClient).toHaveBeenCalledWith(clientId, 'server:clients', sessions);
    });

    it('should send connector:status event with aggregated status', () => {
      const connStatus = [{ id: 'conn-1', protocol: 's7', state: 'connected' }];
      (connectorRegistry.getAggregatedStatus as ReturnType<typeof vi.fn>).mockReturnValue(connStatus);

      invokeHandler();

      const [clientId] = (sseHub.addClient as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sseHub.sendToClient).toHaveBeenCalledWith(clientId, 'connector:status', connStatus);
    });

    it('should send connector:values event with aggregated values', () => {
      const connValues = [{ mappingId: 'map-1', value: 42.5, quality: 'good' }];
      (connectorRegistry.getAggregatedValues as ReturnType<typeof vi.fn>).mockReturnValue(connValues);

      invokeHandler();

      const [clientId] = (sseHub.addClient as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sseHub.sendToClient).toHaveBeenCalledWith(clientId, 'connector:values', connValues);
    });

    it('should call processManager.getStatus for initial state', () => {
      invokeHandler();
      expect(processManager.getStatus).toHaveBeenCalled();
    });

    it('should call processManager.readClientSessions for initial state', () => {
      invokeHandler();
      expect(processManager.readClientSessions).toHaveBeenCalled();
    });

    it('should call connectorRegistry.getAggregatedStatus for initial state', () => {
      invokeHandler();
      expect(connectorRegistry.getAggregatedStatus).toHaveBeenCalled();
    });

    it('should call connectorRegistry.getAggregatedValues for initial state', () => {
      invokeHandler();
      expect(connectorRegistry.getAggregatedValues).toHaveBeenCalled();
    });

    it('should silently ignore errors from processManager.getStatus', () => {
      (processManager.getStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('status read failed');
      });

      expect(() => invokeHandler()).not.toThrow();
      // Other events should still be sent
      expect(processManager.readClientSessions).toHaveBeenCalled();
    });

    it('should silently ignore errors from processManager.readClientSessions', () => {
      (processManager.readClientSessions as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('sessions read failed');
      });

      expect(() => invokeHandler()).not.toThrow();
      expect(connectorRegistry.getAggregatedStatus).toHaveBeenCalled();
    });

    it('should skip connector events when connectorRegistry is not provided', () => {
      const router = createEventsRouter({ sseHub, processManager });
      const layer = (router as any).stack.find(
        (l: any) => l.route && l.route.path === '/' && l.route.methods.get,
      );
      const handler = layer.route.stack[0].handle;
      handler(req, res);

      const sendCalls = (sseHub.sendToClient as ReturnType<typeof vi.fn>).mock.calls;
      const connectorCalls = sendCalls.filter(
        ([, eventType]) => eventType === 'connector:status' || eventType === 'connector:values',
      );
      expect(connectorCalls).toHaveLength(0);
    });
  });

  describe('no authentication', () => {
    it('should not have any middleware before the route handler', () => {
      const router = createEventsRouter({ sseHub, processManager, connectorRegistry });
      const layer = (router as any).stack.find(
        (l: any) => l.route && l.route.path === '/' && l.route.methods.get,
      );
      // Only 1 handler in the route stack means no auth middleware
      expect(layer.route.stack).toHaveLength(1);
    });
  });
});

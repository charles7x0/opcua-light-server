import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppDependencies } from '../../src/api/app.js';
import type { SseHub } from '../../src/api/sse-hub.js';
import type { Express } from 'express';

/**
 * Integration tests for the SSE event delivery via GET /api/events.
 *
 * Uses the real Express app (from createApp) with mocked dependencies.
 * Connects raw HTTP clients to the SSE endpoint and validates event delivery.
 *
 * Validates: Requirements 1.4, 2.4, 3.3, 5.3, 6.3
 */

// ─── Mock Helpers ─────────────────────────────────────────────────────────────

function createMockProcessManager() {
  return {
    getStatus: () => ({ state: 'running' as const, uptime: 120, pid: 9999, connectedClients: 1 }),
    readClientSessions: () => ([
      {
        applicationName: 'TestClient',
        applicationUri: 'urn:test:client',
        securityPolicyUri: 'http://opcfoundation.org/UA/SecurityPolicy#None',
        clientAddress: '127.0.0.1:50000',
        connectTime: '2024-01-15T10:00:00Z',
        sessionState: 'Created',
      },
    ]),
    start: async () => ({ pid: 9999, startedAt: new Date() }),
    stop: async () => {},
    reload: async () => {},
    setSseHub: () => {},
    onCrash: () => {},
  };
}

function createMockConnectorRegistry() {
  return {
    getAggregatedStatus: () => ([
      { id: 'conn-1', protocol: 's7', state: 'connected', lastPoll: '2024-01-15T10:30:05Z' },
    ]),
    getAggregatedValues: () => ([
      { mappingId: 'map-1', value: 42.5, quality: 'good', timestamp: '2024-01-15T10:30:05Z' },
    ]),
    setSseHub: () => {},
    startAll: () => {},
    stopAll: () => {},
    register: () => {},
    onValueUpdate: () => {},
  };
}

function createMockDatabase() {
  return {
    getConnection: () => ({
      prepare: () => ({ run: () => {}, get: () => null, all: () => [] }),
    }),
    close: () => {},
  };
}

function createMockConfigGenerator() {
  return {
    generate: () => ({}),
    writeToFile: () => {},
  };
}

function createMockAuthConfig() {
  return {
    mode: 'none' as const,
    apiKeys: [],
    jwtSecret: undefined,
  };
}

function createMockTofuManager() {
  return {
    getCertificates: () => [],
    trustCertificate: () => {},
    revokeCertificate: () => {},
  };
}

// ─── SSE Client Parser ────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * Connect to an SSE endpoint and collect events.
 * Returns a handle with the collected events and a disconnect function.
 */
function connectSseClient(url: string): {
  events: SseEvent[];
  disconnect: () => void;
  waitForEvents: (count: number, timeoutMs?: number) => Promise<SseEvent[]>;
  connected: Promise<void>;
} {
  const events: SseEvent[] = [];
  let resolveConnected: () => void;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  let buffer = '';
  let currentEvent = '';

  const req = http.get(url, (res) => {
    resolveConnected!();
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr);
            events.push({ event: currentEvent, data });
          } catch {
            // Ignore malformed data
          }
          currentEvent = '';
        }
        // Ignore heartbeat comments and blank lines
      }
    });
  });

  req.on('error', () => {
    // Ignore connection errors on cleanup
  });

  const disconnect = () => {
    req.destroy();
  };

  const waitForEvents = (count: number, timeoutMs = 3000): Promise<SseEvent[]> => {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (events.length >= count) {
          resolve(events.slice(0, count));
          return true;
        }
        return false;
      };

      if (check()) return;

      const interval = setInterval(() => {
        if (check()) clearInterval(interval);
      }, 50);

      setTimeout(() => {
        clearInterval(interval);
        // Return whatever we have, even if less than requested
        resolve([...events]);
      }, timeoutMs);
    });
  };

  return { events, disconnect, waitForEvents, connected };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('SSE Event Delivery Integration Tests', () => {
  let app: Express;
  let sseHub: SseHub;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    const deps: AppDependencies = {
      database: createMockDatabase() as any,
      processManager: createMockProcessManager() as any,
      configGenerator: createMockConfigGenerator() as any,
      connectorRegistry: createMockConnectorRegistry() as any,
      authConfig: createMockAuthConfig() as any,
      tofuManager: createMockTofuManager() as any,
    };

    const instance = createApp(deps);
    app = instance.app;
    sseHub = instance.sseHub;

    // Start HTTP server on random port
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    sseHub.shutdown();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Initial State Events (Req 2.4, 3.3, 5.3, 6.3)', () => {
    it('should deliver initial state events on connect', async () => {
      const client = connectSseClient(`${baseUrl}/api/events`);
      await client.connected;

      // Should receive 4 initial state events: server:status, server:clients, connector:status, connector:values
      const received = await client.waitForEvents(4);
      client.disconnect();

      const eventTypes = received.map((e) => e.event);
      expect(eventTypes).toContain('server:status');
      expect(eventTypes).toContain('server:clients');
      expect(eventTypes).toContain('connector:status');
      expect(eventTypes).toContain('connector:values');

      // Verify server:status payload
      const statusEvent = received.find((e) => e.event === 'server:status');
      expect(statusEvent?.data).toMatchObject({
        state: 'running',
        uptime: 120,
        pid: 9999,
        connectedClients: 1,
      });

      // Verify server:clients payload
      const clientsEvent = received.find((e) => e.event === 'server:clients');
      expect(clientsEvent?.data).toEqual([
        expect.objectContaining({ applicationName: 'TestClient' }),
      ]);

      // Verify connector:status payload
      const connStatusEvent = received.find((e) => e.event === 'connector:status');
      expect(connStatusEvent?.data).toEqual([
        expect.objectContaining({ id: 'conn-1', state: 'connected' }),
      ]);

      // Verify connector:values payload
      const connValuesEvent = received.find((e) => e.event === 'connector:values');
      expect(connValuesEvent?.data).toEqual([
        expect.objectContaining({ mappingId: 'map-1', value: 42.5 }),
      ]);
    });
  });

  describe('Broadcast Event Delivery (Req 1.4)', () => {
    it('should deliver broadcasted server:status event to a connected client', async () => {
      const client = connectSseClient(`${baseUrl}/api/events`);
      await client.connected;

      // Wait for initial events to arrive
      await client.waitForEvents(4);
      const initialCount = client.events.length;

      // Broadcast a status change
      sseHub.broadcast('server:status', {
        state: 'stopped',
        lastError: undefined,
      });

      // Wait for the new event
      await client.waitForEvents(initialCount + 1);
      client.disconnect();

      const broadcastedEvent = client.events.find(
        (e, idx) => idx >= initialCount && e.event === 'server:status'
      );
      expect(broadcastedEvent).toBeDefined();
      expect(broadcastedEvent?.data).toMatchObject({ state: 'stopped' });
    });

    it('should deliver multiple event types via broadcast', async () => {
      const client = connectSseClient(`${baseUrl}/api/events`);
      await client.connected;
      await client.waitForEvents(4);
      const initialCount = client.events.length;

      // Broadcast different event types
      sseHub.broadcast('log:entry', {
        level: 'info',
        message: 'Server started',
        timestamp: '2024-01-15T10:30:00Z',
        source: 'runtime',
      });
      sseHub.broadcast('connector:values', [
        { mappingId: 'map-2', value: 99.9, quality: 'good', timestamp: '2024-01-15T10:31:00Z' },
      ]);

      await client.waitForEvents(initialCount + 2);
      client.disconnect();

      const newEvents = client.events.slice(initialCount);
      const logEvent = newEvents.find((e) => e.event === 'log:entry');
      const valuesEvent = newEvents.find((e) => e.event === 'connector:values');

      expect(logEvent?.data).toMatchObject({ level: 'info', message: 'Server started' });
      expect(valuesEvent?.data).toEqual([
        expect.objectContaining({ mappingId: 'map-2', value: 99.9 }),
      ]);
    });
  });

  describe('Multiple Clients (Req 1.4)', () => {
    it('should deliver the same broadcast event to all connected clients', async () => {
      const client1 = connectSseClient(`${baseUrl}/api/events`);
      const client2 = connectSseClient(`${baseUrl}/api/events`);
      await client1.connected;
      await client2.connected;

      // Wait for initial events on both
      await client1.waitForEvents(4);
      await client2.waitForEvents(4);
      const count1 = client1.events.length;
      const count2 = client2.events.length;

      // Broadcast a single event
      sseHub.broadcast('server:status', { state: 'error', lastError: 'Crash detected' });

      // Both should receive it
      await client1.waitForEvents(count1 + 1);
      await client2.waitForEvents(count2 + 1);
      client1.disconnect();
      client2.disconnect();

      const event1 = client1.events.find(
        (e, idx) => idx >= count1 && e.event === 'server:status'
      );
      const event2 = client2.events.find(
        (e, idx) => idx >= count2 && e.event === 'server:status'
      );

      expect(event1?.data).toMatchObject({ state: 'error', lastError: 'Crash detected' });
      expect(event2?.data).toMatchObject({ state: 'error', lastError: 'Crash detected' });
    });

    it('should track correct client count', async () => {
      expect(sseHub.getClientCount()).toBe(0);

      const client1 = connectSseClient(`${baseUrl}/api/events`);
      await client1.connected;
      // Give time for the client to be registered
      await new Promise((r) => setTimeout(r, 100));
      expect(sseHub.getClientCount()).toBe(1);

      const client2 = connectSseClient(`${baseUrl}/api/events`);
      await client2.connected;
      await new Promise((r) => setTimeout(r, 100));
      expect(sseHub.getClientCount()).toBe(2);

      client1.disconnect();
      // Give time for cleanup
      await new Promise((r) => setTimeout(r, 200));
      expect(sseHub.getClientCount()).toBe(1);

      client2.disconnect();
      await new Promise((r) => setTimeout(r, 200));
      expect(sseHub.getClientCount()).toBe(0);
    });
  });

  describe('Client Cleanup on Disconnect (Req 1.4)', () => {
    it('should remove client from hub when disconnected', async () => {
      const client = connectSseClient(`${baseUrl}/api/events`);
      await client.connected;
      await new Promise((r) => setTimeout(r, 100));

      expect(sseHub.getClientCount()).toBe(1);

      client.disconnect();
      await new Promise((r) => setTimeout(r, 200));

      expect(sseHub.getClientCount()).toBe(0);
    });

    it('should not send events to disconnected clients', async () => {
      const client1 = connectSseClient(`${baseUrl}/api/events`);
      const client2 = connectSseClient(`${baseUrl}/api/events`);
      await client1.connected;
      await client2.connected;
      await client1.waitForEvents(4);
      await client2.waitForEvents(4);

      // Disconnect client1
      client1.disconnect();
      await new Promise((r) => setTimeout(r, 200));

      const count2Before = client2.events.length;

      // Broadcast — should only reach client2
      sseHub.broadcast('server:status', { state: 'running', uptime: 200 });

      await client2.waitForEvents(count2Before + 1);
      client2.disconnect();

      // Client2 should have received the new event
      const newEvent = client2.events.find(
        (e, idx) => idx >= count2Before && e.event === 'server:status'
      );
      expect(newEvent?.data).toMatchObject({ state: 'running', uptime: 200 });

      // Verify hub has 0 clients after both disconnect
      await new Promise((r) => setTimeout(r, 200));
      expect(sseHub.getClientCount()).toBe(0);
    });
  });
});

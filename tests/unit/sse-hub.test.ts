import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SseHub } from '../../src/api/sse-hub.js';
import type { Response } from 'express';

/**
 * Creates a mock Express Response object with writable SSE methods.
 */
function createMockResponse(): Response {
  return {
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
    headersSent: false,
  } as unknown as Response;
}

describe('SseHub', () => {
  let hub: SseHub;

  beforeEach(() => {
    vi.useFakeTimers();
    hub = new SseHub();
  });

  afterEach(() => {
    hub.shutdown();
    vi.useRealTimers();
  });

  describe('client add/remove lifecycle', () => {
    it('should add a client and track it in getClientCount', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);

      expect(hub.getClientCount()).toBe(1);
    });

    it('should emit clientAdded event when a client is added', () => {
      const listener = vi.fn();
      hub.on('clientAdded', listener);

      const res = createMockResponse();
      hub.addClient('client-1', res);

      expect(listener).toHaveBeenCalledWith('client-1');
    });

    it('should remove a client and decrement getClientCount', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);
      hub.removeClient('client-1');

      expect(hub.getClientCount()).toBe(0);
    });

    it('should emit clientRemoved event when a client is removed', () => {
      const listener = vi.fn();
      hub.on('clientRemoved', listener);

      const res = createMockResponse();
      hub.addClient('client-1', res);
      hub.removeClient('client-1');

      expect(listener).toHaveBeenCalledWith('client-1');
    });

    it('should support multiple clients', () => {
      hub.addClient('client-1', createMockResponse());
      hub.addClient('client-2', createMockResponse());
      hub.addClient('client-3', createMockResponse());

      expect(hub.getClientCount()).toBe(3);
    });

    it('should handle removeClient for already-removed client gracefully', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);
      hub.removeClient('client-1');

      // Should not throw or emit event again
      const listener = vi.fn();
      hub.on('clientRemoved', listener);
      hub.removeClient('client-1');

      expect(hub.getClientCount()).toBe(0);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle removeClient for non-existent client gracefully', () => {
      expect(() => hub.removeClient('non-existent')).not.toThrow();
      expect(hub.getClientCount()).toBe(0);
    });
  });

  describe('broadcast', () => {
    it('should deliver event to all connected clients', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      const res3 = createMockResponse();

      hub.addClient('client-1', res1);
      hub.addClient('client-2', res2);
      hub.addClient('client-3', res3);

      hub.broadcast('server:status', { state: 'running' });

      const expectedPayload = 'event: server:status\ndata: {"state":"running"}\n\n';

      expect(res1.write).toHaveBeenCalledWith(expectedPayload);
      expect(res2.write).toHaveBeenCalledWith(expectedPayload);
      expect(res3.write).toHaveBeenCalledWith(expectedPayload);
    });

    it('should not fail when there are no connected clients', () => {
      expect(() => hub.broadcast('server:status', { state: 'stopped' })).not.toThrow();
    });

    it('should remove a client that throws on write', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      (res1.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('EPIPE');
      });

      hub.addClient('client-1', res1);
      hub.addClient('client-2', res2);

      hub.broadcast('server:status', { state: 'running' });

      // client-1 should be removed after error
      expect(hub.getClientCount()).toBe(1);
      // client-2 should still receive the event
      expect(res2.write).toHaveBeenCalled();
    });

    it('should format event payload correctly as SSE wire format', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);

      const data = { connectors: [{ id: 'conn-1', state: 'connected' }] };
      hub.broadcast('connector:status', data);

      const payload = (res.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload).toBe(
        `event: connector:status\ndata: ${JSON.stringify(data)}\n\n`,
      );
    });
  });

  describe('sendToClient', () => {
    it('should deliver event to the specified client only', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      hub.addClient('client-1', res1);
      hub.addClient('client-2', res2);

      hub.sendToClient('client-1', 'server:clients', [{ name: 'UaExpert' }]);

      const expectedPayload = 'event: server:clients\ndata: [{"name":"UaExpert"}]\n\n';
      expect(res1.write).toHaveBeenCalledWith(expectedPayload);
      expect(res2.write).not.toHaveBeenCalled();
    });

    it('should do nothing if client does not exist', () => {
      expect(() =>
        hub.sendToClient('non-existent', 'server:status', { state: 'stopped' }),
      ).not.toThrow();
    });

    it('should remove client if write throws', () => {
      const res = createMockResponse();
      (res.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('EPIPE');
      });

      hub.addClient('client-1', res);
      hub.sendToClient('client-1', 'log:entry', { message: 'test' });

      expect(hub.getClientCount()).toBe(0);
    });
  });

  describe('heartbeat', () => {
    it('should send :heartbeat comment to all clients at 30s interval', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      hub.addClient('client-1', res1);
      hub.addClient('client-2', res2);
      hub.startHeartbeat();

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      expect(res1.write).toHaveBeenCalledWith(':heartbeat\n\n');
      expect(res2.write).toHaveBeenCalledWith(':heartbeat\n\n');
    });

    it('should send multiple heartbeats at each interval', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);
      hub.startHeartbeat();

      // Advance 3 intervals
      vi.advanceTimersByTime(90_000);

      const heartbeatCalls = (res.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === ':heartbeat\n\n',
      );
      expect(heartbeatCalls).toHaveLength(3);
    });

    it('should not start multiple heartbeat timers if called twice', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);

      hub.startHeartbeat();
      hub.startHeartbeat(); // Second call should be ignored

      vi.advanceTimersByTime(30_000);

      const heartbeatCalls = (res.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === ':heartbeat\n\n',
      );
      expect(heartbeatCalls).toHaveLength(1);
    });

    it('should remove client that fails during heartbeat write', () => {
      const res = createMockResponse();
      (res.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Connection reset');
      });

      hub.addClient('client-1', res);
      hub.startHeartbeat();

      vi.advanceTimersByTime(30_000);

      expect(hub.getClientCount()).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should disconnect all clients by calling res.end()', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      hub.addClient('client-1', res1);
      hub.addClient('client-2', res2);
      hub.shutdown();

      expect(res1.end).toHaveBeenCalled();
      expect(res2.end).toHaveBeenCalled();
    });

    it('should remove all clients after shutdown', () => {
      hub.addClient('client-1', createMockResponse());
      hub.addClient('client-2', createMockResponse());
      hub.shutdown();

      expect(hub.getClientCount()).toBe(0);
    });

    it('should stop the heartbeat timer', () => {
      const res = createMockResponse();
      hub.addClient('client-1', res);
      hub.startHeartbeat();
      hub.shutdown();

      // Re-add a client and advance time — no heartbeat should be sent
      const res2 = createMockResponse();
      hub.addClient('client-2', res2);
      vi.advanceTimersByTime(60_000);

      expect(res2.write).not.toHaveBeenCalled();
    });

    it('should handle shutdown gracefully when no clients are connected', () => {
      expect(() => hub.shutdown()).not.toThrow();
    });

    it('should handle client whose res.end() throws during shutdown', () => {
      const res = createMockResponse();
      (res.end as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Already closed');
      });

      hub.addClient('client-1', res);

      // Should not throw
      expect(() => hub.shutdown()).not.toThrow();
      expect(hub.getClientCount()).toBe(0);
    });
  });
});

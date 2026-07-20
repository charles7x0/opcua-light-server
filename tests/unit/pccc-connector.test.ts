import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PcccConnector } from '../../src/connectors/pccc/index.js';
import type { ConnectionConfig, Mapping, ValueUpdate } from '../../src/connectors/types.js';

/**
 * Mock nodepccc PLC instance.
 */
function createMockPLC() {
  return {
    initiateConnection: vi.fn<[any, (err: any) => void], void>(),
    dropConnection: vi.fn<[], void>(),
    setTranslationCB: vi.fn<[(tag: string) => string], void>(),
    addItems: vi.fn<[string | string[]], void>(),
    removeItems: vi.fn<[string | string[]], void>(),
    readAllItems: vi.fn<[(anythingBad: boolean, values?: unknown[]) => void], void>(),
    findItem: vi.fn<[string], { value: unknown; quality: string }>(),
  };
}

/**
 * Testable subclass that overrides createPLC to inject mocks.
 */
class TestablePcccConnector extends PcccConnector {
  public mockPLC = createMockPLC();

  protected createPLC(): any {
    return this.mockPLC;
  }

  /** Reset mock for fresh PLC on reconnect scenarios */
  public resetMockPLC(): void {
    this.mockPLC = createMockPLC();
  }
}

function createConnectionConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    type: 'pccc',
    name: 'Test PCCC',
    params: { host: '192.168.1.10' },
    pollingIntervalMs: 1000,
    reconnectIntervalMs: 5000,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMapping(overrides: Partial<Mapping> = {}): Mapping {
  return {
    id: 'map-1',
    connectionId: 'conn-1',
    nodeId: 'ns=2;s=Temperature',
    deviceAddress: 'N7:0',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PcccConnector', () => {
  let connector: TestablePcccConnector;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new TestablePcccConnector();
  });

  afterEach(() => {
    connector.stop();
    vi.useRealTimers();
  });

  it('should have test infrastructure set up', () => {
    expect(connector.getType()).toBe('pccc');
  });

  // ─── 5.2: Type identification and parameter extraction ───────────────────

  describe('type identification and parameter extraction', () => {
    it('getType() returns "pccc"', () => {
      expect(connector.getType()).toBe('pccc');
    });

    it('extracts host from params', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig({ params: { host: '10.0.0.1' } }));
      connector.start();
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.1' }),
        expect.any(Function),
      );
    });

    it('defaults port to 44818 when not specified', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig({ params: { host: '10.0.0.1' } }));
      connector.start();
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ port: 44818 }),
        expect.any(Function),
      );
    });

    it('uses custom port when specified', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig({ params: { host: '10.0.0.1', port: 5000 } }));
      connector.start();
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ port: 5000 }),
        expect.any(Function),
      );
    });

    it('passes routing when specified', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig({ params: { host: '10.0.0.1', routing: [1, 2, 3] } }));
      connector.start();
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ routing: [1, 2, 3] }),
        expect.any(Function),
      );
    });

    it('throws error when host is missing', () => {
      expect(() => connector.addConnection(createConnectionConfig({ params: {} }))).toThrow(/host/i);
    });

    it('throws error for duplicate connection id', () => {
      connector.addConnection(createConnectionConfig());
      expect(() => connector.addConnection(createConnectionConfig())).toThrow(/already exists/i);
    });
  });

  // ─── 5.3: Connection lifecycle ──────────────────────────────────────────

  describe('connection lifecycle', () => {
    it('addConnection stores configuration', () => {
      connector.addConnection(createConnectionConfig());
      expect(connector.getStatus()).toHaveLength(1);
      expect(connector.getStatus()[0].connectionId).toBe('conn-1');
    });

    it('addConnection initiates connection immediately when running', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.start();
      connector.addConnection(createConnectionConfig());
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalled();
    });

    it('addConnection does NOT initiate when not running', () => {
      connector.addConnection(createConnectionConfig());
      expect(connector.mockPLC.initiateConnection).not.toHaveBeenCalled();
    });

    it('removeConnection disconnects and cleans up', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig());
      connector.start();
      connector.removeConnection('conn-1');
      expect(connector.mockPLC.dropConnection).toHaveBeenCalled();
      expect(connector.getStatus()).toHaveLength(0);
    });

    it('updateConnection disconnects old and reconnects with new config', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig());
      connector.start();
      const callCountBefore = connector.mockPLC.initiateConnection.mock.calls.length;
      connector.resetMockPLC();
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.updateConnection(createConnectionConfig({ params: { host: '10.0.0.2' } }));
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.2' }),
        expect.any(Function),
      );
    });

    it('start is idempotent - calling twice does not duplicate connections', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig());
      connector.start();
      const callCount = connector.mockPLC.initiateConnection.mock.calls.length;
      connector.start();
      expect(connector.mockPLC.initiateConnection.mock.calls.length).toBe(callCount);
    });

    it('stop is idempotent - calling twice does not throw', () => {
      connector.start();
      connector.stop();
      expect(() => connector.stop()).not.toThrow();
    });

    it('disabled connections are skipped on start', () => {
      connector.addConnection(createConnectionConfig({ enabled: false }));
      connector.start();
      expect(connector.mockPLC.initiateConnection).not.toHaveBeenCalled();
    });
  });

  // ─── 5.4: Polling behavior ─────────────────────────────────────────────

  describe('polling behavior', () => {
    it('polling starts after successful connection', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 42, quality: 'OK' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      // readAllItems should be called as part of the initial poll
      expect(connector.mockPLC.readAllItems).toHaveBeenCalled();
    });

    it('value updates emitted with correct nodeId, value, quality', () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 42, quality: 'OK' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      // Filter out the quality "good" updates emitted on connection success
      const pollUpdates = updates.filter((u) => u.value !== undefined);
      expect(pollUpdates).toHaveLength(1);
      expect(pollUpdates[0].nodeId).toBe('ns=2;s=Temperature');
      expect(pollUpdates[0].value).toBe(42);
      expect(pollUpdates[0].quality).toBe('good');
    });

    it('no polling when no mappings exist', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.addConnection(createConnectionConfig());
      connector.start();
      expect(connector.mockPLC.readAllItems).not.toHaveBeenCalled();
    });

    it('polling occurs at configured interval', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 10, quality: 'OK' });
      connector.addConnection(createConnectionConfig({ pollingIntervalMs: 500 }));
      connector.addMapping(createMapping());
      connector.start();
      const initialCalls = connector.mockPLC.readAllItems.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(connector.mockPLC.readAllItems.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  // ─── 5.5: Reconnection logic ───────────────────────────────────────────

  describe('reconnection logic', () => {
    it('reconnect scheduled after connection error', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(new Error('Connection refused')));
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.start();
      // Reset mock to track reconnect attempt
      connector.resetMockPLC();
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      vi.advanceTimersByTime(3000);
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalled();
    });

    it('reconnect scheduled after read error (all items bad)', () => {
      // First connect successfully
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(true));
      connector.mockPLC.findItem.mockReturnValue({ value: undefined, quality: 'BAD 255' });
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.addMapping(createMapping());
      connector.start();
      // After initial poll, all items bad → handleConnectionError → scheduleReconnect
      connector.resetMockPLC();
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      vi.advanceTimersByTime(3000);
      expect(connector.mockPLC.initiateConnection).toHaveBeenCalled();
    });

    it('no reconnect when connector is stopped', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(new Error('fail')));
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.start();
      connector.stop();
      connector.resetMockPLC();
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      vi.advanceTimersByTime(3000);
      expect(connector.mockPLC.initiateConnection).not.toHaveBeenCalled();
    });

    it('quality "good" emitted on successful reconnection', () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));
      // Initial failure
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(new Error('fail')));
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.addMapping(createMapping());
      connector.start();
      // Reset for reconnect success
      connector.resetMockPLC();
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 99, quality: 'OK' });
      updates.length = 0;
      vi.advanceTimersByTime(3000);
      const goodUpdates = updates.filter((u) => u.quality === 'good');
      expect(goodUpdates.length).toBeGreaterThan(0);
    });
  });

  // ─── 5.6: Quality status transitions ───────────────────────────────────

  describe('quality status transitions', () => {
    it('quality "good" emitted on successful connection', () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 1, quality: 'OK' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      const goodUpdates = updates.filter((u) => u.quality === 'good');
      expect(goodUpdates.length).toBeGreaterThan(0);
    });

    it('quality "bad" emitted on connection failure', () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(new Error('fail')));
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates.length).toBeGreaterThan(0);
    });

    it('quality "bad" emitted on read error (all items bad)', () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(true));
      connector.mockPLC.findItem.mockReturnValue({ value: undefined, quality: 'BAD 255' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates.length).toBeGreaterThan(0);
    });

    it('quality "good" emitted on reconnection after failure', () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(new Error('fail')));
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 2000 }));
      connector.addMapping(createMapping());
      connector.start();
      // Reset for reconnect success
      connector.resetMockPLC();
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 5, quality: 'OK' });
      updates.length = 0;
      vi.advanceTimersByTime(2000);
      const goodUpdates = updates.filter((u) => u.quality === 'good');
      expect(goodUpdates.length).toBeGreaterThan(0);
    });

    it('cache reflects quality changes', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 42, quality: 'OK' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      // Values should show quality "good"
      let values = connector.getCurrentValues();
      expect(values[0].quality).toBe('good');
      // Now simulate read error (all bad)
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(true));
      connector.mockPLC.findItem.mockReturnValue({ value: undefined, quality: 'BAD 255' });
      vi.advanceTimersByTime(1000);
      values = connector.getCurrentValues();
      expect(values[0].quality).toBe('bad');
    });
  });

  // ─── 5.7: Status and value reporting ───────────────────────────────────

  describe('status and value reporting', () => {
    it('getStatus() returns correct shape', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 1, quality: 'OK' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      vi.advanceTimersByTime(1000);
      const statuses = connector.getStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toHaveProperty('connectionId', 'conn-1');
      expect(statuses[0]).toHaveProperty('state', 'connected');
      expect(statuses[0]).toHaveProperty('lastPollAt');
    });

    it('getStatus() includes errorMessage on failure', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(new Error('timeout')));
      connector.addConnection(createConnectionConfig());
      connector.start();
      const statuses = connector.getStatus();
      expect(statuses[0].errorMessage).toMatch(/timeout/i);
    });

    it('getCurrentValues() returns correct shape', () => {
      connector.mockPLC.initiateConnection.mockImplementation((_params, cb) => cb(undefined));
      connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
      connector.mockPLC.findItem.mockReturnValue({ value: 99, quality: 'OK' });
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();
      const values = connector.getCurrentValues();
      expect(values).toHaveLength(1);
      expect(values[0]).toHaveProperty('nodeId', 'ns=2;s=Temperature');
      expect(values[0]).toHaveProperty('deviceAddress', 'N7:0');
      expect(values[0]).toHaveProperty('connectionId', 'conn-1');
      expect(values[0]).toHaveProperty('value', 99);
      expect(values[0]).toHaveProperty('quality', 'good');
      expect(values[0]).toHaveProperty('timestamp');
    });

    it('getStatus() returns empty array when no connections', () => {
      expect(connector.getStatus()).toEqual([]);
    });

    it('getCurrentValues() returns empty array when no values', () => {
      expect(connector.getCurrentValues()).toEqual([]);
    });
  });
});

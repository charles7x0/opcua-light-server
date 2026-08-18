import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EthernetIPConnector } from '../../src/connectors/protocols/ethernet-ip/index.js';
import type { ConnectionConfig, Mapping, ValueUpdate } from '../../src/connectors/core/types.js';

/**
 * Mock PLC instance matching the ethernet-ip PLC interface.
 */
function createMockPLC() {
  return {
    connect: vi.fn<[string, any], Promise<void>>().mockResolvedValue(undefined),
    disconnect: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    read: vi.fn<[string | string[]], Promise<any>>(),
  };
}

/**
 * Testable subclass that overrides createPLC to inject mocks.
 */
class TestableEthernetIPConnector extends EthernetIPConnector {
  public mockPLC = createMockPLC();

  protected createPLC(): any {
    return this.mockPLC;
  }
}

function createConnectionConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    type: 'ethernet-ip',
    name: 'Test EIP',
    params: { host: '192.168.1.50' },
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
    nodeId: 'node-1',
    deviceAddress: 'Motor1_Speed',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper: flush all pending microtasks (promises).
 */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('EthernetIPConnector', () => {
  let connector: TestableEthernetIPConnector;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new TestableEthernetIPConnector();
  });

  afterEach(() => {
    connector.stop();
    vi.useRealTimers();
  });

  describe('getType', () => {
    it('should return "ethernet-ip"', () => {
      expect(connector.getType()).toBe('ethernet-ip');
    });
  });

  describe('addConnection', () => {
    it('should parse params with defaults (port 44818, slot 0)', () => {
      const config = createConnectionConfig({
        params: { host: '10.0.0.1' },
      });
      connector.addConnection(config);
      connector.start();

      // Verify connect was called with the host and options containing the default slot
      expect(connector.mockPLC.connect).toHaveBeenCalledWith(
        '10.0.0.1',
        expect.objectContaining({ slot: 0 }),
      );
    });

    it('should parse params with custom port and slot', () => {
      const config = createConnectionConfig({
        params: { host: '10.0.0.2', port: 44819, slot: 2 },
      });
      connector.addConnection(config);
      connector.start();

      expect(connector.mockPLC.connect).toHaveBeenCalledWith(
        '10.0.0.2',
        expect.objectContaining({ slot: 2 }),
      );
    });

    it('should throw if host param is missing', () => {
      const config = createConnectionConfig({
        params: { port: 44818, slot: 0 },
      });

      expect(() => connector.addConnection(config)).toThrow("requires a 'host' parameter");
    });

    it('should add a connection configuration', () => {
      const config = createConnectionConfig();
      connector.addConnection(config);

      const statuses = connector.getStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].connectionId).toBe('conn-1');
      expect(statuses[0].state).toBe('disconnected');
    });

    it('should throw if connection id already exists', () => {
      const config = createConnectionConfig();
      connector.addConnection(config);

      expect(() => connector.addConnection(config)).toThrow(
        "Connection with id 'conn-1' already exists",
      );
    });

    it('should initiate connection immediately if connector is running and enabled', () => {
      connector.start();
      const config = createConnectionConfig();
      connector.addConnection(config);

      expect(connector.mockPLC.connect).toHaveBeenCalled();
    });

    it('should not initiate connection if connector is running but connection is disabled', () => {
      connector.start();
      const config = createConnectionConfig({ enabled: false });
      connector.addConnection(config);

      expect(connector.mockPLC.connect).not.toHaveBeenCalled();
    });
  });

  describe('start / stop', () => {
    it('should initiate connections to all enabled devices on start', () => {
      connector.addConnection(createConnectionConfig({ id: 'conn-1', enabled: true }));
      connector.addConnection(
        createConnectionConfig({
          id: 'conn-2',
          name: 'EIP2',
          params: { host: '192.168.1.51' },
          enabled: true,
        }),
      );

      connector.start();

      expect(connector.mockPLC.connect).toHaveBeenCalledTimes(2);
    });

    it('should not initiate connections to disabled devices on start', () => {
      connector.addConnection(createConnectionConfig({ enabled: false }));
      connector.start();

      expect(connector.mockPLC.connect).not.toHaveBeenCalled();
    });

    it('should be idempotent - calling start twice does nothing extra', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();
      connector.start();

      expect(connector.mockPLC.connect).toHaveBeenCalledTimes(1);
    });

    it('should disconnect all devices and stop polling on stop', async () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      connector.stop();

      expect(connector.mockPLC.disconnect).toHaveBeenCalled();
      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('disconnected');
    });

    it('should be idempotent - calling stop twice does nothing extra', () => {
      connector.start();
      connector.stop();
      connector.stop();
      // No errors thrown
      expect(true).toBe(true);
    });
  });

  describe('quality status updates', () => {
    it('should emit quality "good" on successful connection', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Allow the connect() promise to resolve
      await vi.advanceTimersByTimeAsync(0);

      const goodUpdates = updates.filter((u) => u.quality === 'good' && u.value === undefined);
      expect(goodUpdates).toHaveLength(1);
      expect(goodUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit quality "bad" on connection failure', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.mockPLC.connect.mockRejectedValue(new Error('Connection refused'));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(1);
      expect(badUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit quality "bad" on read error (connection loss)', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      // Connect succeeds
      connector.mockPLC.connect.mockResolvedValue(undefined);
      // Read fails (simulating connection loss)
      connector.mockPLC.read.mockRejectedValue(new Error('Connection lost'));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect and subsequent poll/read to fully settle
      // The promise chain is: connect resolves → poll starts → read rejects → catch fires
      await vi.advanceTimersByTimeAsync(10);

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates.length).toBeGreaterThanOrEqual(1);
      expect(badUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit quality "bad" for all mapped nodes on connection failure', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.mockPLC.connect.mockRejectedValue(new Error('Timeout'));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping({ id: 'map-1', nodeId: 'node-1', deviceAddress: 'Tag1' }));
      connector.addMapping(createMapping({ id: 'map-2', nodeId: 'node-2', deviceAddress: 'Tag2' }));
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(2);
      expect(badUpdates.map((u) => u.nodeId).sort()).toEqual(['node-1', 'node-2']);
    });

    it('should emit quality "good" on reconnection after failure', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      // First connection attempt fails
      connector.mockPLC.connect
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 1000 }));
      connector.addMapping(createMapping());
      connector.start();

      // Allow first connect to fail
      await vi.advanceTimersByTimeAsync(0);

      // Clear updates from the failure
      updates.length = 0;

      // Advance time to trigger reconnection
      await vi.advanceTimersByTimeAsync(1000);

      // Allow reconnect promise to resolve
      await vi.advanceTimersByTimeAsync(0);

      const goodUpdates = updates.filter((u) => u.quality === 'good' && u.value === undefined);
      expect(goodUpdates).toHaveLength(1);
      expect(goodUpdates[0].nodeId).toBe('node-1');
    });
  });

  describe('reconnection logic', () => {
    it('should schedule reconnection after connection failure', async () => {
      connector.mockPLC.connect
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.start();

      // Allow first connect to fail
      await vi.advanceTimersByTimeAsync(0);

      expect(connector.mockPLC.connect).toHaveBeenCalledTimes(1);

      // Advance to reconnection time
      await vi.advanceTimersByTimeAsync(3000);

      expect(connector.mockPLC.connect).toHaveBeenCalledTimes(2);
    });

    it('should schedule reconnection after read error', async () => {
      connector.mockPLC.connect.mockResolvedValue(undefined);
      connector.mockPLC.read.mockRejectedValueOnce(new Error('Connection lost'));

      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 5000 }));
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect to succeed
      await vi.advanceTimersByTimeAsync(0);
      // Allow read to fail
      await vi.advanceTimersByTimeAsync(0);

      // Reset mock to succeed on reconnect
      connector.mockPLC.connect.mockResolvedValue(undefined);

      // Advance to reconnection time
      await vi.advanceTimersByTimeAsync(5000);

      // connect called: first time + reconnection
      expect(connector.mockPLC.connect).toHaveBeenCalledTimes(2);
    });

    it('should not reconnect if connector has been stopped', async () => {
      connector.mockPLC.connect.mockRejectedValue(new Error('Connection refused'));

      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 1000 }));
      connector.start();

      // Allow connect to fail
      await vi.advanceTimersByTimeAsync(0);

      connector.stop();

      // Advance past reconnection interval
      await vi.advanceTimersByTimeAsync(1000);

      // Should only have been called once (initial attempt)
      expect(connector.mockPLC.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('connection state transitions', () => {
    it('should set state to connected on successful connection', async () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('connected');
    });

    it('should set state to error on connection failure', async () => {
      connector.mockPLC.connect.mockRejectedValue(new Error('Connection refused'));

      connector.addConnection(createConnectionConfig());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('error');
      expect(statuses[0].errorMessage).toBe('Connection refused');
    });

    it('should set state to disconnected on read error (was connected)', async () => {
      connector.mockPLC.connect.mockResolvedValue(undefined);
      connector.mockPLC.read.mockRejectedValue(new Error('Connection lost'));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect to succeed
      await vi.advanceTimersByTimeAsync(0);
      // Allow read to fail
      await vi.advanceTimersByTimeAsync(0);

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('disconnected');
      expect(statuses[0].errorMessage).toBe('Connection lost');
    });
  });

  describe('polling behavior', () => {
    it('should poll mapped tags after successful connection', async () => {
      connector.mockPLC.read.mockResolvedValue(42.5);

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect to succeed
      await vi.advanceTimersByTimeAsync(0);

      expect(connector.mockPLC.read).toHaveBeenCalled();
    });

    it('should emit value updates from poll results', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      // Single tag read returns the raw value (not wrapped in array)
      connector.mockPLC.read.mockResolvedValue(42.5);

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect to succeed
      await vi.advanceTimersByTimeAsync(0);
      // Allow read to resolve
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      const valueUpdates = updates.filter((u) => u.value !== undefined);
      expect(valueUpdates).toHaveLength(1);
      expect(valueUpdates[0].nodeId).toBe('node-1');
      expect(valueUpdates[0].value).toBe(42.5);
      expect(valueUpdates[0].quality).toBe('good');
    });

    it('should not poll if no mappings exist', async () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(connector.mockPLC.read).not.toHaveBeenCalled();
    });

    it('should poll at the configured interval', async () => {
      connector.mockPLC.read.mockResolvedValue(10.0);

      connector.addConnection(createConnectionConfig({ pollingIntervalMs: 500 }));
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect to succeed
      await vi.advanceTimersByTimeAsync(0);

      // Initial poll
      expect(connector.mockPLC.read).toHaveBeenCalledTimes(1);

      // Allow first read to resolve
      await vi.advanceTimersByTimeAsync(0);

      // Advance to next poll interval
      await vi.advanceTimersByTimeAsync(500);

      expect(connector.mockPLC.read).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus', () => {
    it('should return empty array when no connections configured', () => {
      expect(connector.getStatus()).toEqual([]);
    });

    it('should return status for all connections', () => {
      connector.addConnection(createConnectionConfig({ id: 'conn-1' }));
      connector.addConnection(
        createConnectionConfig({
          id: 'conn-2',
          name: 'EIP2',
          params: { host: '192.168.1.51' },
        }),
      );

      const statuses = connector.getStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses[0].connectionId).toBe('conn-1');
      expect(statuses[1].connectionId).toBe('conn-2');
    });

    it('should include errorMessage on error state', async () => {
      connector.mockPLC.connect.mockRejectedValue(new Error('ECONNREFUSED'));

      connector.addConnection(createConnectionConfig());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('error');
      expect(statuses[0].errorMessage).toBe('ECONNREFUSED');
    });
  });

  describe('getCurrentValues', () => {
    it('should return empty array when no values have been read', () => {
      expect(connector.getCurrentValues()).toEqual([]);
    });

    it('should return current values after successful poll', async () => {
      // Single tag read returns the raw value (not wrapped in array)
      connector.mockPLC.read.mockResolvedValue(42.5);

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Allow connect to succeed
      await vi.advanceTimersByTimeAsync(0);
      // Allow read to resolve
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      const values = connector.getCurrentValues();
      expect(values).toHaveLength(1);
      expect(values[0].nodeId).toBe('node-1');
      expect(values[0].deviceAddress).toBe('Motor1_Speed');
      expect(values[0].connectionId).toBe('conn-1');
      expect(values[0].value).toBe(42.5);
      expect(values[0].quality).toBe('good');
    });
  });
});

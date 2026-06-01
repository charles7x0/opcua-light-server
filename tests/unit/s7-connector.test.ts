import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S7Connector, type S7ValueUpdate } from '../../src/s7-connector/index.js';
import type { S7ConnectionConfig, S7Mapping } from '../../src/types/index.js';

/**
 * Mock nodes7 client instance.
 */
function createMockNodes7Client() {
  return {
    initiateConnection: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    readAllItems: vi.fn(),
    dropConnection: vi.fn(),
  };
}

/**
 * Testable subclass that overrides createNodeS7Instance to inject mocks.
 */
class TestableS7Connector extends S7Connector {
  public mockClient = createMockNodes7Client();

  protected createNodeS7Instance(): any {
    return this.mockClient;
  }
}

function createConnectionConfig(overrides: Partial<S7ConnectionConfig> = {}): S7ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'Test PLC',
    host: '192.168.1.100',
    rack: 0,
    slot: 1,
    pollingIntervalMs: 1000,
    reconnectIntervalMs: 5000,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMapping(overrides: Partial<S7Mapping> = {}): S7Mapping {
  return {
    id: 'map-1',
    connectionId: 'conn-1',
    nodeId: 'node-1',
    plcAddress: 'DB1,REAL0',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('S7Connector', () => {
  let connector: TestableS7Connector;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new TestableS7Connector();
  });

  afterEach(() => {
    connector.stop();
    vi.useRealTimers();
  });

  describe('addConnection', () => {
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
        "Connection with id 'conn-1' already exists"
      );
    });

    it('should initiate connection immediately if connector is running and enabled', () => {
      connector.start();
      const config = createConnectionConfig();
      connector.addConnection(config);

      expect(connector.mockClient.initiateConnection).toHaveBeenCalled();
    });

    it('should not initiate connection if connector is running but connection is disabled', () => {
      connector.start();
      const config = createConnectionConfig({ enabled: false });
      connector.addConnection(config);

      expect(connector.mockClient.initiateConnection).not.toHaveBeenCalled();
    });
  });

  describe('removeConnection', () => {
    it('should remove a connection and clean up', () => {
      const config = createConnectionConfig();
      connector.addConnection(config);
      connector.removeConnection('conn-1');

      const statuses = connector.getStatus();
      expect(statuses).toHaveLength(0);
    });

    it('should throw if connection id not found', () => {
      expect(() => connector.removeConnection('nonexistent')).toThrow(
        "Connection with id 'nonexistent' not found"
      );
    });

    it('should stop polling and disconnect when removing an active connection', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      connector.removeConnection('conn-1');

      expect(connector.mockClient.dropConnection).toHaveBeenCalled();
      expect(connector.getStatus()).toHaveLength(0);
    });
  });

  describe('addMapping', () => {
    it('should add a mapping to the specified connection', () => {
      connector.addConnection(createConnectionConfig());
      const mapping = createMapping();
      connector.addMapping(mapping);

      // No error means success
      expect(true).toBe(true);
    });

    it('should throw if connection id not found', () => {
      const mapping = createMapping({ connectionId: 'nonexistent' });
      expect(() => connector.addMapping(mapping)).toThrow(
        "Connection with id 'nonexistent' not found"
      );
    });

    it('should add item to nodes7 client if connection is active', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      connector.addMapping(createMapping());

      expect(connector.mockClient.addItems).toHaveBeenCalledWith('DB1,REAL0');
    });
  });

  describe('removeMapping', () => {
    it('should remove a mapping from its connection', () => {
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.removeMapping('map-1');

      // No error means success
      expect(true).toBe(true);
    });

    it('should throw if mapping id not found', () => {
      connector.addConnection(createConnectionConfig());
      expect(() => connector.removeMapping('nonexistent')).toThrow(
        "Mapping with id 'nonexistent' not found"
      );
    });

    it('should remove item from nodes7 client if connection is active', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      connector.addMapping(createMapping());
      connector.removeMapping('map-1');

      expect(connector.mockClient.removeItems).toHaveBeenCalledWith('DB1,REAL0');
    });
  });

  describe('start / stop', () => {
    it('should initiate connections to all enabled PLCs on start', () => {
      connector.addConnection(createConnectionConfig({ id: 'conn-1', enabled: true }));
      connector.addConnection(createConnectionConfig({ id: 'conn-2', name: 'PLC2', host: '192.168.1.101', enabled: true }));

      connector.start();

      expect(connector.mockClient.initiateConnection).toHaveBeenCalledTimes(2);
    });

    it('should not initiate connections to disabled PLCs on start', () => {
      connector.addConnection(createConnectionConfig({ enabled: false }));

      connector.start();

      expect(connector.mockClient.initiateConnection).not.toHaveBeenCalled();
    });

    it('should be idempotent - calling start twice does nothing extra', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();
      connector.start();

      expect(connector.mockClient.initiateConnection).toHaveBeenCalledTimes(1);
    });

    it('should disconnect all PLCs and stop polling on stop', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      connector.stop();

      expect(connector.mockClient.dropConnection).toHaveBeenCalled();
      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('disconnected');
    });

    it('should be idempotent - calling stop twice does nothing extra', () => {
      connector.start();
      connector.stop();
      connector.stop();

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('polling behavior', () => {
    it('should poll mapped variables after successful connection', () => {
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // readAllItems should have been called (initial poll)
      expect(connector.mockClient.readAllItems).toHaveBeenCalled();
    });

    it('should emit value updates from poll results', () => {
      const updates: S7ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Clear the initial quality "good" update emitted on connection
      updates.length = 0;

      // Simulate successful read
      const readCallback = connector.mockClient.readAllItems.mock.calls[0][0];
      readCallback(null, { 'DB1,REAL0': 42.5 });

      expect(updates).toHaveLength(1);
      expect(updates[0].nodeId).toBe('node-1');
      expect(updates[0].value).toBe(42.5);
      expect(updates[0].quality).toBe('good');
    });

    it('should poll at the configured interval', () => {
      connector.addConnection(createConnectionConfig({ pollingIntervalMs: 500 }));
      connector.addMapping(createMapping());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Initial poll
      expect(connector.mockClient.readAllItems).toHaveBeenCalledTimes(1);

      // Simulate successful read for initial poll
      const readCallback = connector.mockClient.readAllItems.mock.calls[0][0];
      readCallback(null, { 'DB1,REAL0': 10.0 });

      // Advance time by polling interval
      vi.advanceTimersByTime(500);

      expect(connector.mockClient.readAllItems).toHaveBeenCalledTimes(2);
    });

    it('should not poll if no mappings exist', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      // Simulate successful connection (no mappings added)
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // readAllItems should not be called since there are no mappings
      expect(connector.mockClient.readAllItems).not.toHaveBeenCalled();
    });
  });

  describe('connection state transitions', () => {
    it('should set state to connected on successful connection', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('connected');
    });

    it('should set state to error on connection failure', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(new Error('Connection refused'));

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('error');
      expect(statuses[0].errorMessage).toBe('Connection refused');
    });

    it('should set state to disconnected on read error (was connected)', () => {
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Simulate read error (connection lost)
      const readCallback = connector.mockClient.readAllItems.mock.calls[0][0];
      readCallback(new Error('Connection lost'));

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('disconnected');
      expect(statuses[0].errorMessage).toBe('Connection lost');
    });
  });

  describe('reconnection logic', () => {
    it('should schedule reconnection after connection failure', () => {
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.start();

      // Simulate connection failure
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(new Error('Connection refused'));

      expect(connector.mockClient.initiateConnection).toHaveBeenCalledTimes(1);

      // Advance time past reconnect interval
      vi.advanceTimersByTime(3000);

      expect(connector.mockClient.initiateConnection).toHaveBeenCalledTimes(2);
    });

    it('should schedule reconnection after read error', () => {
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 5000 }));
      connector.addMapping(createMapping());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Simulate read error
      const readCallback = connector.mockClient.readAllItems.mock.calls[0][0];
      readCallback(new Error('Timeout'));

      // Advance time past reconnect interval
      vi.advanceTimersByTime(5000);

      // Should attempt reconnection
      expect(connector.mockClient.initiateConnection).toHaveBeenCalledTimes(2);
    });

    it('should not reconnect if connector has been stopped', () => {
      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 1000 }));
      connector.start();

      // Simulate connection failure
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(new Error('Connection refused'));

      // Stop the connector
      connector.stop();

      // Advance time past reconnect interval
      vi.advanceTimersByTime(1000);

      // Should not attempt reconnection (only the initial attempt)
      expect(connector.mockClient.initiateConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('quality status updates', () => {
    it('should emit good quality on successful connection', () => {
      const updates: S7ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Should emit good quality for mapped nodes
      const qualityUpdates = updates.filter((u) => u.quality === 'good' && u.value === undefined);
      expect(qualityUpdates).toHaveLength(1);
      expect(qualityUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit bad quality on connection loss', () => {
      const updates: S7ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Simulate successful connection
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Clear previous updates
      updates.length = 0;

      // Simulate read error (connection lost)
      const readCallback = connector.mockClient.readAllItems.mock.calls[0][0];
      readCallback(new Error('Connection lost'));

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(1);
      expect(badUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit bad quality for all mapped nodes on connection failure', () => {
      const updates: S7ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping({ id: 'map-1', nodeId: 'node-1', plcAddress: 'DB1,REAL0' }));
      connector.addMapping(createMapping({ id: 'map-2', nodeId: 'node-2', plcAddress: 'DB1,REAL4' }));
      connector.start();

      // Simulate connection failure
      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(new Error('Timeout'));

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(2);
      expect(badUpdates.map((u) => u.nodeId).sort()).toEqual(['node-1', 'node-2']);
    });
  });

  describe('getStatus', () => {
    it('should return empty array when no connections configured', () => {
      expect(connector.getStatus()).toEqual([]);
    });

    it('should return status for all connections', () => {
      connector.addConnection(createConnectionConfig({ id: 'conn-1' }));
      connector.addConnection(createConnectionConfig({ id: 'conn-2', name: 'PLC2', host: '192.168.1.101' }));

      const statuses = connector.getStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses[0].connectionId).toBe('conn-1');
      expect(statuses[1].connectionId).toBe('conn-2');
    });

    it('should include lastPollAt after successful poll', () => {
      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(null);

      // Simulate successful read
      const readCallback = connector.mockClient.readAllItems.mock.calls[0][0];
      readCallback(null, { 'DB1,REAL0': 10.0 });

      const statuses = connector.getStatus();
      expect(statuses[0].lastPollAt).toBeDefined();
    });

    it('should include errorMessage on error state', () => {
      connector.addConnection(createConnectionConfig());
      connector.start();

      const connectCallback = connector.mockClient.initiateConnection.mock.calls[0][1];
      connectCallback(new Error('ECONNREFUSED'));

      const statuses = connector.getStatus();
      expect(statuses[0].state).toBe('error');
      expect(statuses[0].errorMessage).toBe('ECONNREFUSED');
    });
  });
});

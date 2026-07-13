import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModbusConnector } from '../../src/connectors/modbus-tcp/index.js';
import type { ConnectionConfig, Mapping, ValueUpdate } from '../../src/connectors/types.js';

/**
 * Mock modbus-serial client instance.
 */
function createMockModbusClient() {
  return {
    connectTCP: vi.fn<[string, { port: number }], Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn(),
    setID: vi.fn(),
    readHoldingRegisters: vi.fn().mockResolvedValue({ data: [0] }),
    readInputRegisters: vi.fn().mockResolvedValue({ data: [0] }),
    readCoils: vi.fn().mockResolvedValue({ data: [false] }),
    readDiscreteInputs: vi.fn().mockResolvedValue({ data: [false] }),
  };
}

/**
 * Testable subclass that overrides createModbusClient to inject mocks.
 */
class TestableModbusConnector extends ModbusConnector {
  public mockClient = createMockModbusClient();

  protected createModbusClient(): any {
    return this.mockClient;
  }
}

function createConnectionConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    type: 'modbus-tcp',
    name: 'Test Modbus',
    params: { host: '192.168.1.100', port: 502, unitId: 1 },
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
    deviceAddress: 'HR:100:1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ModbusConnector', () => {
  let connector: TestableModbusConnector;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new TestableModbusConnector();
  });

  afterEach(() => {
    connector.stop();
    vi.useRealTimers();
  });

  describe('getType', () => {
    it('should return "modbus-tcp"', () => {
      expect(connector.getType()).toBe('modbus-tcp');
    });
  });

  describe('params parsing with defaults', () => {
    it('should use default port 502 when not specified', async () => {
      const config = createConnectionConfig({
        params: { host: '10.0.0.1' },
      });
      connector.addConnection(config);
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(connector.mockClient.connectTCP).toHaveBeenCalledWith('10.0.0.1', { port: 502 });
    });

    it('should use default unitId 1 when not specified', async () => {
      const config = createConnectionConfig({
        params: { host: '10.0.0.1' },
      });
      connector.addConnection(config);
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(connector.mockClient.setID).toHaveBeenCalledWith(1);
    });

    it('should use specified port and unitId', async () => {
      const config = createConnectionConfig({
        params: { host: '10.0.0.1', port: 5020, unitId: 5 },
      });
      connector.addConnection(config);
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(connector.mockClient.connectTCP).toHaveBeenCalledWith('10.0.0.1', { port: 5020 });
      expect(connector.mockClient.setID).toHaveBeenCalledWith(5);
    });

    it('should throw if host param is missing', () => {
      const config = createConnectionConfig({
        params: { port: 502, unitId: 1 },
      });

      expect(() => connector.addConnection(config)).toThrow("requires a 'host' parameter");
    });
  });

  describe('parseDeviceAddress', () => {
    it('should parse HR:address:count format', () => {
      expect(connector.parseDeviceAddress('HR:100:2')).toEqual({
        type: 'HR',
        address: 100,
        count: 2,
      });
    });

    it('should parse IR:address:count format', () => {
      expect(connector.parseDeviceAddress('IR:0:1')).toEqual({
        type: 'IR',
        address: 0,
        count: 1,
      });
    });

    it('should parse CO:address format', () => {
      expect(connector.parseDeviceAddress('CO:5')).toEqual({
        type: 'CO',
        address: 5,
        count: 1,
      });
    });

    it('should parse DI:address format', () => {
      expect(connector.parseDeviceAddress('DI:8')).toEqual({
        type: 'DI',
        address: 8,
        count: 1,
      });
    });

    it('should default count to 1 for HR when count is omitted', () => {
      expect(connector.parseDeviceAddress('HR:100')).toEqual({
        type: 'HR',
        address: 100,
        count: 1,
      });
    });

    it('should throw for unknown register type', () => {
      expect(() => connector.parseDeviceAddress('XX:0')).toThrow(
        /Unknown Modbus register type/,
      );
    });

    it('should throw for invalid format (missing address)', () => {
      expect(() => connector.parseDeviceAddress('HR')).toThrow(
        /Invalid Modbus device address format/,
      );
    });
  });

  describe('quality updates on connection failure and restoration', () => {
    it('should emit quality "bad" when connection fails', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.mockClient.connectTCP.mockRejectedValue(new Error('ECONNREFUSED'));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(1);
      expect(badUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit quality "good" when connection succeeds', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const goodUpdates = updates.filter((u) => u.quality === 'good' && u.value === undefined);
      expect(goodUpdates).toHaveLength(1);
      expect(goodUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit quality "bad" for all mapped nodes on connection failure', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.mockClient.connectTCP.mockRejectedValue(new Error('ECONNREFUSED'));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping({ id: 'map-1', nodeId: 'node-1', deviceAddress: 'HR:100:1' }));
      connector.addMapping(createMapping({ id: 'map-2', nodeId: 'node-2', deviceAddress: 'HR:200:1' }));
      connector.start();

      await vi.advanceTimersByTimeAsync(0);

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(2);
      expect(badUpdates.map((u) => u.nodeId).sort()).toEqual(['node-1', 'node-2']);
    });

    it('should emit quality "good" on reconnection after failure', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      // First connection fails
      connector.mockClient.connectTCP.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 3000 }));
      connector.addMapping(createMapping());
      connector.start();

      // Wait for the failed connection attempt
      await vi.advanceTimersByTimeAsync(0);

      // Clear updates from failure
      updates.length = 0;

      // Reconnection: make next attempt succeed
      connector.mockClient.connectTCP.mockResolvedValue(undefined);

      // Advance time to trigger reconnection
      await vi.advanceTimersByTimeAsync(3000);

      // After reconnection, we get a quality "good" update (value=undefined) indicating
      // connection restored, plus potentially a poll result with an actual value.
      // The important thing is that at least one "good" quality update with value=undefined
      // is emitted to signal the connection restoration.
      const qualityGoodUpdates = updates.filter((u) => u.quality === 'good' && u.value === undefined);
      expect(qualityGoodUpdates.length).toBeGreaterThanOrEqual(1);
      expect(qualityGoodUpdates[0].nodeId).toBe('node-1');
    });

    it('should emit quality "bad" when read fails with connection error', async () => {
      const updates: ValueUpdate[] = [];
      connector.onValueUpdate((u) => updates.push(...u));

      connector.addConnection(createConnectionConfig());
      connector.addMapping(createMapping());
      connector.start();

      // Wait for connection to succeed
      await vi.advanceTimersByTimeAsync(0);

      // Clear previous updates (connection good)
      updates.length = 0;

      // Make the next read fail with a connection error
      connector.mockClient.readHoldingRegisters.mockRejectedValue(new Error('Port not open'));

      // Advance to next poll interval
      await vi.advanceTimersByTimeAsync(1000);

      const badUpdates = updates.filter((u) => u.quality === 'bad');
      expect(badUpdates).toHaveLength(1);
      expect(badUpdates[0].nodeId).toBe('node-1');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectorRegistry } from '../../src/connectors/core/connector-registry.js';
import type {
  Connector,
  ConnectorType,
  ConnectorMetadata,
  ConnectionConfig,
  ConnectionStatus,
  CurrentValue,
  Mapping,
  ValueUpdateCallback,
} from '../../src/connectors/core/types.js';

/** Minimal mock connector for testing registry metadata methods. */
function createMockConnector(type: ConnectorType): Connector {
  return {
    getType: () => type,
    start: () => {},
    stop: () => {},
    addConnection: (_config: ConnectionConfig) => {},
    removeConnection: (_id: string) => {},
    updateConnection: (_config: ConnectionConfig) => {},
    addMapping: (_mapping: Mapping) => {},
    removeMapping: (_id: string) => {},
    getStatus: (): ConnectionStatus[] => [],
    getCurrentValues: (): CurrentValue[] => [],
    onValueUpdate: (_callback: ValueUpdateCallback) => {},
  };
}

/** Create sample metadata for a given connector type. */
function createMetadata(type: ConnectorType, displayName: string): ConnectorMetadata {
  return {
    type,
    displayName,
    description: `${displayName} protocol connector`,
    icon: '🔌',
    paramsSchema: [
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.1' },
      { key: 'port', label: 'Port', type: 'number', required: false, defaultValue: 502, min: 1, max: 65535 },
    ],
  };
}

describe('ConnectorRegistry metadata methods', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
  });

  describe('getProtocolsMetadata()', () => {
    it('should return all registered metadata', () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata = createMetadata('s7', 'Siemens S7');

      const modbusConnector = createMockConnector('modbus-tcp');
      const modbusMetadata = createMetadata('modbus-tcp', 'Modbus TCP');

      registry.register(s7Connector, s7Metadata);
      registry.register(modbusConnector, modbusMetadata);

      const result = registry.getProtocolsMetadata();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(s7Metadata);
      expect(result).toContainEqual(modbusMetadata);
    });

    it('should return empty array when no connectors are registered', () => {
      const result = registry.getProtocolsMetadata();
      expect(result).toEqual([]);
    });

    it('should not include connectors registered without metadata', () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata = createMetadata('s7', 'Siemens S7');

      const modbusConnector = createMockConnector('modbus-tcp');

      registry.register(s7Connector, s7Metadata);
      registry.register(modbusConnector); // no metadata

      const result = registry.getProtocolsMetadata();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('s7');
    });
  });

  describe('getProtocolMetadata(type)', () => {
    it('should return metadata for a registered type', () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata = createMetadata('s7', 'Siemens S7');

      registry.register(s7Connector, s7Metadata);

      const result = registry.getProtocolMetadata('s7');

      expect(result).toEqual(s7Metadata);
    });

    it('should return undefined for an unknown type', () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata = createMetadata('s7', 'Siemens S7');

      registry.register(s7Connector, s7Metadata);

      const result = registry.getProtocolMetadata('unknown');

      expect(result).toBeUndefined();
    });

    it('should return undefined for a connector registered without metadata', () => {
      const modbusConnector = createMockConnector('modbus-tcp');

      registry.register(modbusConnector); // no metadata

      const result = registry.getProtocolMetadata('modbus-tcp');

      expect(result).toBeUndefined();
    });
  });

  describe('getParamsSchema(type)', () => {
    it('should return the paramsSchema array for a known type', () => {
      const s7Connector = createMockConnector('s7');
      const s7Metadata = createMetadata('s7', 'Siemens S7');

      registry.register(s7Connector, s7Metadata);

      const result = registry.getParamsSchema('s7');

      expect(result).toEqual(s7Metadata.paramsSchema);
      expect(result).toHaveLength(2);
      expect(result![0].key).toBe('host');
      expect(result![1].key).toBe('port');
    });

    it('should return undefined for an unknown type', () => {
      const result = registry.getParamsSchema('unknown');

      expect(result).toBeUndefined();
    });

    it('should return undefined for a connector registered without metadata', () => {
      const modbusConnector = createMockConnector('modbus-tcp');

      registry.register(modbusConnector); // no metadata

      const result = registry.getParamsSchema('modbus-tcp');

      expect(result).toBeUndefined();
    });
  });
});

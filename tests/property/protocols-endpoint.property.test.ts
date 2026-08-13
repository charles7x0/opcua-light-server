import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { ConnectorRegistry } from '../../src/connectors/connector-registry.js';
import type { Connector, ConnectorMetadata, ParamFieldSchema, ConnectorType, ConnectionConfig, Mapping, ConnectionStatus, CurrentValue, ValueUpdate, ValueUpdateCallback } from '../../src/connectors/types.js';

/**
 * Feature: connector-plugin-architecture
 * Property 2: Protocols endpoint returns complete metadata for all registered connectors
 *
 * Validates: Requirements 4.1, 4.2
 *
 * For any set of registered connectors with metadata, calling getProtocolsMetadata()
 * SHALL return an array containing one entry per registered connector, where each
 * entry includes type, displayName, and a non-empty paramsSchema array.
 */

/** Create a minimal mock connector implementing the Connector interface. */
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

/** Generate a valid connector type (lowercase alphanumeric with hyphens). */
const arbConnectorType: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{1,14}$/)
  .filter((s) => !s.endsWith('-'));

/** Generate a non-empty display name. */
const arbDisplayName: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/** Generate a valid ParamFieldSchema entry. */
const arbParamField: fc.Arbitrary<ParamFieldSchema> = fc.record({
  key: fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,9}$/).filter((s) => s.length >= 1),
  label: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  type: fc.constantFrom('text' as const, 'number' as const, 'boolean' as const, 'select' as const),
  required: fc.boolean(),
});

/** Generate a non-empty paramsSchema array (1-5 fields). */
const arbParamsSchema: fc.Arbitrary<ParamFieldSchema[]> = fc.array(arbParamField, {
  minLength: 1,
  maxLength: 5,
});

/** Generate a valid ConnectorMetadata with the given type. */
function arbMetadataForType(type: string): fc.Arbitrary<ConnectorMetadata> {
  return fc.tuple(arbDisplayName, arbParamsSchema).map(([displayName, paramsSchema]) => ({
    type,
    displayName,
    paramsSchema,
  }));
}

/** Generate a list of 1-5 unique connector types with their metadata. */
const arbConnectorsSet: fc.Arbitrary<{ type: string; metadata: ConnectorMetadata }[]> = fc
  .uniqueArray(arbConnectorType, { minLength: 1, maxLength: 5 })
  .chain((types) =>
    fc.tuple(...types.map((t) => arbMetadataForType(t).map((meta) => ({ type: t, metadata: meta }))))
  );

describe('Feature: connector-plugin-architecture, Property 2: Protocols endpoint returns complete metadata for all registered connectors', () => {
  /**
   * Validates: Requirements 4.1, 4.2
   *
   * For any set of connectors registered with metadata, getProtocolsMetadata()
   * SHALL return one entry per registered connector with type, displayName,
   * and a non-empty paramsSchema.
   */
  it('returns one metadata entry per registered connector with type, displayName, and non-empty paramsSchema', () => {
    fc.assert(
      fc.property(arbConnectorsSet, (connectors) => {
        // Create a fresh registry for each iteration
        const registry = new ConnectorRegistry();

        // Register all connectors with their metadata
        for (const { type, metadata } of connectors) {
          const connector = createMockConnector(type);
          registry.register(connector, metadata);
        }

        // Call the method under test
        const protocols = registry.getProtocolsMetadata();

        // Assert: one entry per registered connector
        expect(protocols).toHaveLength(connectors.length);

        // Assert: each registered type appears in the result
        for (const { type, metadata } of connectors) {
          const entry = protocols.find((p) => p.type === type);
          expect(entry).toBeDefined();

          // Assert: entry includes type
          expect(entry!.type).toBe(type);

          // Assert: entry includes displayName
          expect(entry!.displayName).toBe(metadata.displayName);

          // Assert: entry has non-empty paramsSchema
          expect(Array.isArray(entry!.paramsSchema)).toBe(true);
          expect(entry!.paramsSchema.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 4.1, 4.2
   *
   * Empty registry returns empty protocols list.
   */
  it('returns empty array when no connectors are registered', () => {
    const registry = new ConnectorRegistry();
    const protocols = registry.getProtocolsMetadata();
    expect(protocols).toHaveLength(0);
    expect(protocols).toEqual([]);
  });
});

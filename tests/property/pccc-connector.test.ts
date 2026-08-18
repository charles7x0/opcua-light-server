import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { PcccConnector } from '../../src/connectors/protocols/pccc/index.js';
import type { ConnectionConfig, Mapping, ValueUpdate } from '../../src/connectors/core/types.js';

/**
 * Mock nodepccc PLC instance for property testing.
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


/**
 * Property 1: Only enabled connections are initiated on start
 *
 * For any set of managed connections with varying `enabled` states,
 * calling `start()` SHALL initiate connections only for those where
 * `enabled` is true, and SHALL not initiate for those where `enabled` is false.
 *
 * **Validates: Requirements 3.1, 3.2**
 */
describe('Feature: pccc-connector, Property 1: Only enabled connections are initiated on start', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initiateConnection is called only for enabled configs', () => {
    const connectionConfigArb = fc.array(
      fc.record({
        enabled: fc.boolean(),
        hostOctet: fc.integer({ min: 1, max: 254 }),
      }),
      { minLength: 1, maxLength: 10 },
    );

    fc.assert(
      fc.property(connectionConfigArb, (configs) => {
        const connector = new TestablePcccConnector();
        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => cb(undefined));
        connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));

        // Add connections with unique ids
        for (let i = 0; i < configs.length; i++) {
          connector.addConnection(
            createConnectionConfig({
              id: `conn-${i}`,
              name: `PLC ${i}`,
              enabled: configs[i].enabled,
              params: { host: `192.168.1.${configs[i].hostOctet}` },
            }),
          );
        }

        connector.start();

        const enabledCount = configs.filter((c) => c.enabled).length;
        expect(connector.mockPLC.initiateConnection).toHaveBeenCalledTimes(enabledCount);

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 2: Start and stop are idempotent
 *
 * For any connector state, calling start() N times SHALL produce the same
 * observable state as calling start() once. Similarly, calling stop() M times
 * SHALL produce the same state as calling stop() once, without throwing errors.
 *
 * **Validates: Requirements 3.4, 3.5**
 */
describe('Feature: pccc-connector, Property 2: Start and stop are idempotent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('random sequences of start/stop never throw errors', () => {
    const sequenceArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 20 });

    fc.assert(
      fc.property(sequenceArb, (sequence) => {
        const connector = new TestablePcccConnector();
        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => cb(undefined));
        connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));

        // Add one connection to make start/stop meaningful
        connector.addConnection(createConnectionConfig());

        // Execute random sequence: true = start(), false = stop()
        for (const action of sequence) {
          if (action) {
            expect(() => connector.start()).not.toThrow();
          } else {
            expect(() => connector.stop()).not.toThrow();
          }
        }

        // Determine final expected state based on last action
        const lastAction = sequence[sequence.length - 1];
        const statuses = connector.getStatus();
        expect(statuses).toHaveLength(1);

        if (lastAction) {
          // Last call was start — state should be connected
          expect(statuses[0].state).toBe('connected');
        } else {
          // Last call was stop — state should be disconnected
          expect(statuses[0].state).toBe('disconnected');
        }

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 3: Connection state transitions are correct
 *
 * For any connection attempt, if the connection callback receives no error,
 * the state SHALL be "connected". If the callback receives an error on initial
 * connect, the state SHALL be "error". After a failure, reconnection attempts
 * transition state accordingly.
 *
 * **Validates: Requirements 4.2, 4.3, 4.4**
 */
describe('Feature: pccc-connector, Property 3: Connection state transitions are correct', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('state reflects connect success/failure sequence correctly', () => {
    // Generate sequences of failures followed by an optional final success.
    // Each failure triggers a reconnect timer, so we can advance through them.
    const failCountArb = fc.integer({ min: 0, max: 9 });
    const finalSuccessArb = fc.boolean();

    fc.assert(
      fc.property(failCountArb, finalSuccessArb, (failCount, finalSuccess) => {
        const connector = new TestablePcccConnector();
        connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));

        // Start with initial failure to enter reconnect cycle
        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => {
          cb(new Error('Connection refused'));
        });

        connector.addConnection(createConnectionConfig({ reconnectIntervalMs: 1000 }));
        connector.start();

        // After initial failure, state should be "error"
        let statuses = connector.getStatus();
        expect(statuses[0].state).toBe('error');

        // Process N consecutive failures via reconnect timer
        for (let i = 0; i < failCount; i++) {
          connector.resetMockPLC();
          connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
          connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => {
            cb(new Error('Connection refused'));
          });

          vi.advanceTimersByTime(1000);

          statuses = connector.getStatus();
          // After reconnect failure, state should be "error" or "disconnected"
          expect(['error', 'disconnected']).toContain(statuses[0].state);
        }

        // Optionally succeed on final reconnect
        if (finalSuccess) {
          connector.resetMockPLC();
          connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
          connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => {
            cb(undefined);
          });

          vi.advanceTimersByTime(1000);

          statuses = connector.getStatus();
          expect(statuses[0].state).toBe('connected');
        }

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 4: Valid PCCC file addresses are accepted
 *
 * For any valid PCCC file-based address matching the pattern, adding a mapping
 * with that address SHALL succeed without error.
 *
 * **Validates: Requirements 5.1**
 */
describe('Feature: pccc-connector, Property 4: Valid PCCC file addresses are accepted', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('all generated valid PCCC addresses pass addMapping validation', () => {
    const fileTypeArb = fc.constantFrom('N', 'F', 'B', 'T', 'C', 'S', 'L', 'O', 'I', 'R', 'ST');
    const fileNumberArb = fc.integer({ min: 0, max: 255 });
    const elementArb = fc.integer({ min: 0, max: 999 });
    const bitArb = fc.option(fc.integer({ min: 0, max: 15 }), { nil: undefined });
    const subElementArb = fc.option(
      fc.constantFrom('DN', 'EN', 'TT', 'ACC', 'PRE', 'LEN', 'POS'),
      { nil: undefined },
    );

    const addressArb = fc.tuple(fileTypeArb, fileNumberArb, elementArb, bitArb, subElementArb).map(
      ([fileType, fileNumber, element, bit, sub]) => {
        let address = `${fileType}${fileNumber}:${element}`;
        if (bit !== undefined) {
          address += `/${bit}`;
        } else if (sub !== undefined) {
          address += `.${sub}`;
        }
        return address;
      },
    );

    fc.assert(
      fc.property(addressArb, (address) => {
        const connector = new TestablePcccConnector();
        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => cb(undefined));

        connector.addConnection(createConnectionConfig());

        expect(() =>
          connector.addMapping(
            createMapping({
              id: `map-${address}`,
              deviceAddress: address,
            }),
          ),
        ).not.toThrow();

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 5: Poll results are correctly partitioned
 *
 * For any set of mappings where some have a nodeId and some have nodeId set to null,
 * after a successful poll cycle: (a) ALL mappings SHALL have their values cached in
 * currentValues regardless of nodeId, and (b) the valueUpdateCallback SHALL receive
 * updates ONLY for mappings that have a non-null nodeId.
 *
 * **Validates: Requirements 6.2, 6.3**
 */
describe('Feature: pccc-connector, Property 5: Poll results are correctly partitioned', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('all mappings are cached but only non-null nodeId mappings are emitted via callback', () => {
    const mappingConfigArb = fc.array(
      fc.record({
        hasNodeId: fc.boolean(),
        index: fc.integer({ min: 0, max: 999 }),
      }),
      { minLength: 1, maxLength: 10 },
    );

    fc.assert(
      fc.property(mappingConfigArb, (mappingConfigs) => {
        const connector = new TestablePcccConnector();
        const updates: ValueUpdate[] = [];
        connector.onValueUpdate((u) => updates.push(...u));

        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => cb(undefined));
        connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
        connector.mockPLC.findItem.mockReturnValue({ value: 42, quality: 'OK' });

        connector.addConnection(createConnectionConfig());

        // Add mappings with varying nodeId presence
        for (let i = 0; i < mappingConfigs.length; i++) {
          const cfg = mappingConfigs[i];
          connector.addMapping(
            createMapping({
              id: `map-${i}`,
              nodeId: cfg.hasNodeId ? `ns=2;s=Node_${i}` : null,
              deviceAddress: `N7:${cfg.index}`,
            }),
          );
        }

        connector.start();

        // Check cached values — ALL mappings should be cached
        const currentValues = connector.getCurrentValues();
        expect(currentValues.length).toBe(mappingConfigs.length);

        // Check callback updates — only non-null nodeId mappings should be emitted
        // Filter out the initial quality "good" updates and poll updates
        const withNodeId = mappingConfigs.filter((c) => c.hasNodeId).length;
        const pollUpdates = updates.filter((u) => u.value === 42);
        expect(pollUpdates.length).toBe(withNodeId);

        // Verify every poll update has a non-null nodeId
        for (const update of pollUpdates) {
          expect(update.nodeId).toBeTruthy();
        }

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 7: Successful connection emits quality "good" for all mappings
 *
 * For any set of mappings associated with a connection, when that connection
 * transitions to "connected", the connector SHALL emit quality "good" for every
 * mapping that has a non-null nodeId.
 *
 * **Validates: Requirements 7.4, 8.1**
 */
describe('Feature: pccc-connector, Property 6: Successful connection emits quality good for all mappings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('quality good is emitted for every mapping with non-null nodeId on connection success', () => {
    const mappingCountArb = fc.integer({ min: 1, max: 20 });

    fc.assert(
      fc.property(mappingCountArb, (count) => {
        const connector = new TestablePcccConnector();
        const updates: ValueUpdate[] = [];
        connector.onValueUpdate((u) => updates.push(...u));

        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) => cb(undefined));
        connector.mockPLC.readAllItems.mockImplementation((cb) => cb(false));
        connector.mockPLC.findItem.mockReturnValue({ value: 0, quality: 'OK' });

        connector.addConnection(createConnectionConfig());

        // Add mappings with non-null nodeIds
        for (let i = 0; i < count; i++) {
          connector.addMapping(
            createMapping({
              id: `map-${i}`,
              nodeId: `ns=2;s=Node_${i}`,
              deviceAddress: `N7:${i}`,
            }),
          );
        }

        connector.start();

        // The emitQualityUpdate on connection success should emit "good" for all mappings
        const goodUpdates = updates.filter((u) => u.quality === 'good');
        expect(goodUpdates.length).toBeGreaterThanOrEqual(count);

        // Every mapping nodeId should appear at least once with quality "good"
        for (let i = 0; i < count; i++) {
          const nodeId = `ns=2;s=Node_${i}`;
          const found = goodUpdates.some((u) => u.nodeId === nodeId);
          expect(found).toBe(true);
        }

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 8: Connection or read error emits quality "bad" for all mappings
 *
 * For any set of mappings associated with a connection, when a connection error
 * or read error occurs, the connector SHALL emit quality "bad" for every mapping
 * that has a non-null nodeId.
 *
 * **Validates: Requirements 8.2, 8.3**
 */
describe('Feature: pccc-connector, Property 7: Connection or read error emits quality bad for all mappings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('quality bad is emitted for every mapping with non-null nodeId on connection error', () => {
    const mappingCountArb = fc.integer({ min: 1, max: 20 });

    fc.assert(
      fc.property(mappingCountArb, (count) => {
        const connector = new TestablePcccConnector();
        const updates: ValueUpdate[] = [];
        connector.onValueUpdate((u) => updates.push(...u));

        connector.mockPLC.initiateConnection.mockImplementation((_p, cb) =>
          cb(new Error('Connection refused')),
        );

        connector.addConnection(createConnectionConfig());

        // Add mappings with non-null nodeIds
        for (let i = 0; i < count; i++) {
          connector.addMapping(
            createMapping({
              id: `map-${i}`,
              nodeId: `ns=2;s=Node_${i}`,
              deviceAddress: `N7:${i}`,
            }),
          );
        }

        connector.start();

        // The emitQualityUpdate on connection error should emit "bad" for all mappings
        const badUpdates = updates.filter((u) => u.quality === 'bad');
        expect(badUpdates.length).toBeGreaterThanOrEqual(count);

        // Every mapping nodeId should appear at least once with quality "bad"
        for (let i = 0; i < count; i++) {
          const nodeId = `ns=2;s=Node_${i}`;
          const found = badUpdates.some((u) => u.nodeId === nodeId);
          expect(found).toBe(true);
        }

        connector.stop();
      }),
      { numRuns: 100 },
    );
  });
});

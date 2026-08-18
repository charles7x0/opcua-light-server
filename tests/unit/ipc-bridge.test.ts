import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpcBridge } from '../../src/connectors/core/ipc-bridge.js';
import type { ValueUpdate } from '../../src/connectors/core/types.js';

/**
 * Creates a mock ConfigGenerator that returns an AddressSpaceConfig
 * with the specified namespace/node structure.
 */
function createMockConfigGenerator(
  namespaces: Array<{ name: string; nodes: Array<{ name: string; nodeId: string }> }> = [
    {
      name: 'TestNamespace',
      nodes: [
        { name: 'Temperature', nodeId: 'ns=2;s=Temperature' },
        { name: 'Pressure', nodeId: 'ns=2;s=Pressure' },
      ],
    },
  ],
) {
  return {
    generate: vi.fn().mockReturnValue({
      version: 1,
      generatedAt: new Date().toISOString(),
      security: { mode: 'None' },
      namespaces: namespaces.map((ns) => ({
        name: ns.name,
        uri: `urn:test:${ns.name}`,
        objectNodes: [],
        nodes: ns.nodes.map((n) => ({
          name: n.name,
          nodeId: n.nodeId,
          dataType: 'Float',
          parentPath: '',
        })),
      })),
    }),
  };
}

/**
 * Creates a mock ProcessManager.
 */
function createMockProcessManager(state: 'running' | 'stopped' = 'running') {
  return {
    getStatus: vi.fn().mockReturnValue({ state }),
    writeToStdin: vi.fn(),
  };
}

/**
 * Creates a mock Database with a prepare().get() chain that resolves
 * node names to UUIDs.
 */
function createMockDatabase(
  nodeMap: Record<string, { namespaceName: string; id: string }> = {
    Temperature: { namespaceName: 'TestNamespace', id: 'uuid-temp-001' },
    Pressure: { namespaceName: 'TestNamespace', id: 'uuid-press-002' },
  },
) {
  const getMock = vi.fn((nodeName: string, namespaceName: string) => {
    const entry = nodeMap[nodeName];
    if (entry && entry.namespaceName === namespaceName) {
      return { id: entry.id };
    }
    return undefined;
  });

  const prepareMock = vi.fn().mockReturnValue({ get: getMock });

  return {
    getConnection: vi.fn().mockReturnValue({
      prepare: prepareMock,
    }),
    _prepareMock: prepareMock,
    _getMock: getMock,
  };
}

function createValueUpdate(overrides: Partial<ValueUpdate> = {}): ValueUpdate {
  return {
    nodeId: 'uuid-temp-001',
    value: 25.5,
    quality: 'good',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('IpcBridge', () => {
  let bridge: IpcBridge;
  let mockConfigGenerator: ReturnType<typeof createMockConfigGenerator>;
  let mockProcessManager: ReturnType<typeof createMockProcessManager>;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockConfigGenerator = createMockConfigGenerator();
    mockProcessManager = createMockProcessManager('running');
    mockDatabase = createMockDatabase();

    bridge = new IpcBridge(
      mockConfigGenerator as any,
      mockProcessManager as any,
      mockDatabase as any,
    );
  });

  describe('handleValueUpdates - runtime state', () => {
    it('should skip updates when runtime is not running', () => {
      mockProcessManager.getStatus.mockReturnValue({ state: 'stopped' });

      bridge.handleValueUpdates([createValueUpdate()]);

      expect(mockProcessManager.writeToStdin).not.toHaveBeenCalled();
      expect(mockConfigGenerator.generate).not.toHaveBeenCalled();
    });
  });

  describe('handleValueUpdates - node ID map building', () => {
    it('should build node ID map on first call', () => {
      bridge.handleValueUpdates([createValueUpdate()]);

      expect(mockConfigGenerator.generate).toHaveBeenCalledTimes(1);
      expect(mockDatabase.getConnection).toHaveBeenCalled();
    });

    it('should resolve UUID to OPC UA node ID and write to stdin', () => {
      bridge.handleValueUpdates([createValueUpdate({ nodeId: 'uuid-temp-001' })]);

      expect(mockProcessManager.writeToStdin).toHaveBeenCalledTimes(1);

      const writtenMessage = mockProcessManager.writeToStdin.mock.calls[0][0];
      const parsed = JSON.parse(writtenMessage.trim());

      expect(parsed.type).toBe('value_update');
      expect(parsed.updates).toHaveLength(1);
      expect(parsed.updates[0].nodeId).toBe('ns=2;s=Temperature');
      expect(parsed.updates[0].value).toBe(25.5);
      expect(parsed.updates[0].quality).toBe('good');
      expect(parsed.updates[0].timestamp).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should cache the map and reuse on subsequent calls', () => {
      bridge.handleValueUpdates([createValueUpdate()]);
      bridge.handleValueUpdates([createValueUpdate()]);

      // generate() should only have been called once (map was cached)
      expect(mockConfigGenerator.generate).toHaveBeenCalledTimes(1);
    });

    it('should rebuild map when a node UUID is not found in the map', () => {
      // First call builds the map normally
      bridge.handleValueUpdates([createValueUpdate({ nodeId: 'uuid-temp-001' })]);
      expect(mockConfigGenerator.generate).toHaveBeenCalledTimes(1);

      // Add a new node to the mock so rebuild will find it
      const updatedNodeMap = {
        Temperature: { namespaceName: 'TestNamespace', id: 'uuid-temp-001' },
        Pressure: { namespaceName: 'TestNamespace', id: 'uuid-press-002' },
        NewNode: { namespaceName: 'TestNamespace', id: 'uuid-new-003' },
      };
      mockDatabase._getMock.mockImplementation((nodeName: string, namespaceName: string) => {
        const entry = updatedNodeMap[nodeName as keyof typeof updatedNodeMap];
        if (entry && entry.namespaceName === namespaceName) {
          return { id: entry.id };
        }
        return undefined;
      });
      mockConfigGenerator.generate.mockReturnValue({
        version: 1,
        generatedAt: new Date().toISOString(),
        security: { mode: 'None' },
        namespaces: [
          {
            name: 'TestNamespace',
            uri: 'urn:test:TestNamespace',
            objectNodes: [],
            nodes: [
              { name: 'Temperature', nodeId: 'ns=2;s=Temperature', dataType: 'Float', parentPath: '' },
              { name: 'Pressure', nodeId: 'ns=2;s=Pressure', dataType: 'Float', parentPath: '' },
              { name: 'NewNode', nodeId: 'ns=2;s=NewNode', dataType: 'Float', parentPath: '' },
            ],
          },
        ],
      });

      // Second call with unknown UUID should trigger a rebuild
      bridge.handleValueUpdates([createValueUpdate({ nodeId: 'uuid-new-003' })]);

      // generate() called a second time for the rebuild
      expect(mockConfigGenerator.generate).toHaveBeenCalledTimes(2);
      expect(mockProcessManager.writeToStdin).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleValueUpdates - batch processing', () => {
    it('should handle multiple updates in a single batch', () => {
      const updates: ValueUpdate[] = [
        createValueUpdate({ nodeId: 'uuid-temp-001', value: 25.5 }),
        createValueUpdate({ nodeId: 'uuid-press-002', value: 101.3 }),
      ];

      bridge.handleValueUpdates(updates);

      expect(mockProcessManager.writeToStdin).toHaveBeenCalledTimes(1);

      const writtenMessage = mockProcessManager.writeToStdin.mock.calls[0][0];
      const parsed = JSON.parse(writtenMessage.trim());

      expect(parsed.type).toBe('value_update');
      expect(parsed.updates).toHaveLength(2);
      expect(parsed.updates[0].nodeId).toBe('ns=2;s=Temperature');
      expect(parsed.updates[1].nodeId).toBe('ns=2;s=Pressure');
    });

    it('should log warning when no updates can be resolved', () => {
      // Use a UUID that doesn't exist in the map even after rebuild
      const updates: ValueUpdate[] = [
        createValueUpdate({ nodeId: 'uuid-nonexistent' }),
      ];

      bridge.handleValueUpdates(updates);

      // writeToStdin should NOT be called since no updates resolved
      expect(mockProcessManager.writeToStdin).not.toHaveBeenCalled();
    });
  });

  describe('invalidateMap', () => {
    it('should clear the map when invalidateMap() is called (next call rebuilds)', () => {
      // First call builds the map
      bridge.handleValueUpdates([createValueUpdate()]);
      expect(mockConfigGenerator.generate).toHaveBeenCalledTimes(1);

      // Invalidate the cache
      bridge.invalidateMap();

      // Next call should rebuild the map
      bridge.handleValueUpdates([createValueUpdate()]);
      expect(mockConfigGenerator.generate).toHaveBeenCalledTimes(2);
    });
  });
});

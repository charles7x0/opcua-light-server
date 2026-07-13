import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ConnectorsManager } from '../../web/src/screens/connectors/ConnectorsManager';
import type { ConnectorConnection, ConnectorStatus } from '../../web/src/api';

// Mock the API module
vi.mock('../../web/src/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getConnections: vi.fn(),
    getConnectorStatus: vi.fn(),
    getMappings: vi.fn().mockResolvedValue([]),
    getConnectorValues: vi.fn().mockResolvedValue([]),
    getNodes: vi.fn().mockResolvedValue([]),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    createMapping: vi.fn(),
    deleteMapping: vi.fn(),
    exportConnectorMappingsCsv: vi.fn(),
    importConnectorMappingsCsv: vi.fn(),
  };
});

import { getConnections, getConnectorStatus } from '../../web/src/api';

const mockedGetConnections = vi.mocked(getConnections);
const mockedGetConnectorStatus = vi.mocked(getConnectorStatus);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function makeConnection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    id: 'conn-1',
    type: 's7',
    name: 'Test PLC',
    params: { host: '192.168.1.10', rack: 0, slot: 1 },
    pollingIntervalMs: 1000,
    reconnectIntervalMs: 5000,
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Bug Condition Exploration Tests ──────────────────────────────────────────
// These tests encode the EXPECTED behavior. They will FAIL on unfixed code,
// confirming that the bug exists (placeholder UI instead of functional subcomponents).

describe('Bug Condition: ConnectorsManager renders placeholder UI instead of functional subcomponents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConnectorStatus.mockResolvedValue([]);
  });

  /**
   * **Validates: Requirements 1.1, 2.1**
   * Test 1: ProtocolSelector should render when user clicks "+ New Connection"
   * BUG: Renders placeholder <p> text instead of ProtocolSelector component
   */
  it('renders ProtocolSelector with protocol cards when "+ New Connection" is clicked', async () => {
    const user = userEvent.setup();
    mockedGetConnections.mockResolvedValue([]);

    render(<ConnectorsManager />, { wrapper: createWrapper() });

    // Wait for loading to finish
    const newConnBtn = await screen.findByRole('button', { name: /new connection/i });
    await user.click(newConnBtn);

    // Expected: ProtocolSelector renders with aria-label for protocol selection
    // Bug: finds placeholder <p> text "Protocol selection flow (coming soon)" instead
    expect(screen.getByLabelText('Select Siemens S7 protocol')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Modbus TCP protocol')).toBeInTheDocument();
    expect(screen.getByLabelText('Select EtherNet/IP protocol')).toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 1.3, 2.3**
   * Test 2: ConnectionCard should render with Edit/Delete buttons
   * BUG: Inline <div> cards without Edit/Delete buttons are rendered instead of ConnectionCard
   */
  it('renders ConnectionCard components with Edit/Delete buttons when connections exist', async () => {
    const connections: ConnectorConnection[] = [
      makeConnection({ id: 'conn-1', name: 'PLC Floor 1', type: 's7' }),
      makeConnection({ id: 'conn-2', name: 'Modbus Sensor', type: 'modbus-tcp' }),
    ];
    mockedGetConnections.mockResolvedValue(connections);

    render(<ConnectorsManager />, { wrapper: createWrapper() });

    // Wait for connections to render
    await screen.findByText('PLC Floor 1');

    // Expected: ConnectionCard renders with Edit/Delete buttons
    // Bug: inline <div> cards without these buttons
    expect(screen.getByLabelText('Edit connection PLC Floor 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete connection PLC Floor 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit connection Modbus Sensor')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete connection Modbus Sensor')).toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 1.6, 2.7**
   * Test 3: CsvImportExport component should be rendered on the Connectors screen
   * BUG: CsvImportExport component is not mounted at all
   */
  it('renders CsvImportExport component with Export/Import buttons', async () => {
    mockedGetConnections.mockResolvedValue([]);

    render(<ConnectorsManager />, { wrapper: createWrapper() });

    // Wait for loading to finish (empty state will show)
    await screen.findByText(/no connections configured/i);

    // Expected: CsvImportExport renders with Export and Import buttons
    // Bug: component is never mounted
    expect(screen.getByRole('button', { name: /export mappings csv/i })).toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 1.2, 1.3, 2.3**
   * Test 4: Property-based test — for any random set of connections with any protocol type,
   * all connections should render via ConnectionCard with protocol badges.
   * BUG: Inline divs are rendered instead of ConnectionCard components with proper badges
   */
  it('property: all connections render via ConnectionCard with protocol badges for any protocol type', async () => {
    const protocolTypes = ['s7', 'modbus-tcp', 'ethernet-ip'] as const;
    const protocolLabels: Record<string, string> = {
      's7': 'S7',
      'modbus-tcp': 'Modbus TCP',
      'ethernet-ip': 'EtherNet/IP',
    };

    // Generate random connections with random protocol types
    const connectionArb = fc.record({
      id: fc.uuid(),
      type: fc.constantFrom(...protocolTypes),
      name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      pollingIntervalMs: fc.integer({ min: 100, max: 10000 }),
      reconnectIntervalMs: fc.integer({ min: 1000, max: 30000 }),
    });

    const connectionsArb = fc.array(connectionArb, { minLength: 1, maxLength: 5 });

    await fc.assert(
      fc.asyncProperty(connectionsArb, async (generatedConnections) => {
        const connections: ConnectorConnection[] = generatedConnections.map((gc) => ({
          id: gc.id,
          type: gc.type,
          name: gc.name,
          params: { host: '192.168.1.1' },
          pollingIntervalMs: gc.pollingIntervalMs,
          reconnectIntervalMs: gc.reconnectIntervalMs,
          enabled: true,
          createdAt: '2024-01-01T00:00:00Z',
        }));

        mockedGetConnections.mockResolvedValue(connections);
        mockedGetConnectorStatus.mockResolvedValue([]);

        const { unmount } = render(<ConnectorsManager />, { wrapper: createWrapper() });

        // Wait for first connection name to render
        await screen.findByText(connections[0].name);

        // Expected: each connection renders with a protocol badge via ConnectionCard
        // Bug: inline divs without protocol badges from ConnectionCard
        for (const conn of connections) {
          const expectedLabel = protocolLabels[conn.type];
          const badge = screen.getByLabelText(`Protocol: ${expectedLabel}`);
          expect(badge).toBeInTheDocument();
        }

        unmount();
        vi.clearAllMocks();
      }),
      { numRuns: 10 },
    );
  });
});

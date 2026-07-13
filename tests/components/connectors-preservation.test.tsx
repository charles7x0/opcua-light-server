import { render, screen, waitFor } from '@testing-library/react';
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
    id: `conn-${Math.random().toString(36).slice(2)}`,
    type: 's7',
    name: 'Test Connection',
    params: { host: '192.168.1.1' },
    pollingIntervalMs: 1000,
    reconnectIntervalMs: 5000,
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Preservation: Loading State ──────────────────────────────────────────────

describe('Preservation: Loading State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConnectorStatus.mockResolvedValue([]);
  });

  it('renders "Loading connections..." with aria-live="polite" when query is pending', () => {
    // Keep getConnections pending (never resolves)
    mockedGetConnections.mockReturnValue(new Promise(() => {}));

    render(<ConnectorsManager />, { wrapper: createWrapper() });

    const loadingText = screen.getByText('Loading connections...');
    expect(loadingText).toBeInTheDocument();

    // Verify aria-live="polite" is present on a parent element
    const ariaLiveEl = loadingText.closest('[aria-live="polite"]');
    expect(ariaLiveEl).not.toBeNull();
  });
});

// ─── Preservation: Empty State ────────────────────────────────────────────────

describe('Preservation: Empty State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConnectorStatus.mockResolvedValue([]);
  });

  it('renders "No connections configured" when connections array is empty', async () => {
    mockedGetConnections.mockResolvedValue([]);

    render(<ConnectorsManager />, { wrapper: createWrapper() });

    expect(await screen.findByText(/No connections configured/)).toBeInTheDocument();
  });
});

// ─── Preservation: Filter Tabs ────────────────────────────────────────────────

describe('Preservation: Filter Tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConnectorStatus.mockResolvedValue([]);
  });

  /**
   * **Validates: Requirements 3.1**
   * Property: For any non-default protocol filter from ['s7', 'modbus-tcp', 'ethernet-ip'],
   * switching to that tab triggers getConnections with the correct type filter parameter.
   * Then switching back to "All" triggers getConnections with undefined.
   */
  it('property: switching filter tabs calls getConnections with correct filter', async () => {
    const NON_DEFAULT_FILTERS = ['s7', 'modbus-tcp', 'ethernet-ip'] as const;
    const TAB_LABELS_MAP: Record<string, string> = {
      's7': 'S7',
      'modbus-tcp': 'Modbus TCP',
      'ethernet-ip': 'EtherNet/IP',
    };

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_DEFAULT_FILTERS),
        async (filterValue) => {
          vi.clearAllMocks();
          mockedGetConnections.mockResolvedValue([]);
          mockedGetConnectorStatus.mockResolvedValue([]);

          const user = userEvent.setup();
          const { unmount } = render(<ConnectorsManager />, { wrapper: createWrapper() });

          // Wait for loading to complete (tabs only render after loading finishes)
          await waitFor(() => {
            expect(screen.queryByText('Loading connections...')).not.toBeInTheDocument();
          });

          // Click a non-default filter tab
          const tabButton = screen.getByRole('button', { name: TAB_LABELS_MAP[filterValue] });
          await user.click(tabButton);

          // Verify getConnections is called with the filter value
          await waitFor(() => {
            expect(mockedGetConnections).toHaveBeenCalledWith(filterValue);
          });

          // Switch back to "All" tab
          const allButton = screen.getByRole('button', { name: 'All' });
          await user.click(allButton);

          // Verify getConnections is called with undefined (no filter)
          await waitFor(() => {
            expect(mockedGetConnections).toHaveBeenCalledWith(undefined);
          });

          unmount();
        },
      ),
      { numRuns: 10 },
    );
  });

  it('connections are filtered by protocol type when clicking filter tabs', async () => {
    const s7Connections = [makeConnection({ id: 'c1', type: 's7', name: 'S7 Conn' })];
    const modbusConnections = [makeConnection({ id: 'c2', type: 'modbus-tcp', name: 'Modbus Conn' })];

    mockedGetConnections.mockResolvedValue(s7Connections);

    const user = userEvent.setup();
    render(<ConnectorsManager />, { wrapper: createWrapper() });

    // Wait for initial load
    expect(await screen.findByText('S7 Conn')).toBeInTheDocument();

    // Click "Modbus TCP" tab
    mockedGetConnections.mockResolvedValue(modbusConnections);
    await user.click(screen.getByRole('button', { name: 'Modbus TCP' }));

    expect(await screen.findByText('Modbus Conn')).toBeInTheDocument();
  });
});

// ─── Preservation: Protocol Tab Labels ────────────────────────────────────────

describe('Preservation: Protocol Tab Labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConnectorStatus.mockResolvedValue([]);
  });

  /**
   * **Validates: Requirements 3.1**
   * Property: Regardless of connection data, all protocol filter tabs render with
   * correct labels ("All", "S7", "Modbus TCP", "EtherNet/IP").
   */
  it('property: all filter tab labels render regardless of connection data', async () => {
    const PROTOCOL_TYPES = ['s7', 'modbus-tcp', 'ethernet-ip'] as const;
    const EXPECTED_LABELS = ['All', 'S7', 'Modbus TCP', 'EtherNet/IP'];

    const connectionArb = fc.record({
      id: fc.uuid(),
      type: fc.constantFrom(...PROTOCOL_TYPES),
      name: fc.string({ minLength: 1, maxLength: 30 }),
      params: fc.constant({ host: '10.0.0.1' }),
      pollingIntervalMs: fc.constant(1000),
      reconnectIntervalMs: fc.constant(5000),
      enabled: fc.boolean(),
      createdAt: fc.constant('2024-01-01T00:00:00Z'),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(connectionArb, { minLength: 0, maxLength: 5 }),
        async (connections) => {
          vi.clearAllMocks();
          mockedGetConnections.mockResolvedValue(connections as ConnectorConnection[]);
          mockedGetConnectorStatus.mockResolvedValue([]);

          const { unmount } = render(<ConnectorsManager />, { wrapper: createWrapper() });

          // Wait for loading to complete
          await waitFor(() => {
            expect(screen.queryByText('Loading connections...')).not.toBeInTheDocument();
          });

          // All tab labels must be present
          for (const label of EXPECTED_LABELS) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
          }

          unmount();
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ─── Preservation: Status Polling ─────────────────────────────────────────────

describe('Preservation: Status Polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.5**
   * The getConnectorStatus query uses refetchInterval: 5000 for real-time status badges.
   * We verify by checking that getConnectorStatus is called on render.
   */
  it('getConnectorStatus is called on initial render for status polling', async () => {
    mockedGetConnections.mockResolvedValue([
      makeConnection({ id: 'conn-1', name: 'PLC 1' }),
    ]);
    mockedGetConnectorStatus.mockResolvedValue([
      { connectionId: 'conn-1', state: 'connected' } as ConnectorStatus,
    ]);

    render(<ConnectorsManager />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockedGetConnectorStatus).toHaveBeenCalled();
    });
  });
});

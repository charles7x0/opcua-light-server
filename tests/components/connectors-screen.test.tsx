import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolSelector } from '../../web/src/screens/connectors/ProtocolSelector';
import { ConnectionForm } from '../../web/src/screens/connectors/ConnectionForm';
import { ConnectionCard } from '../../web/src/screens/connectors/ConnectionCard';
import { MappingTable } from '../../web/src/screens/connectors/MappingTable';
import { ConnectorsManager } from '../../web/src/screens/connectors/ConnectorsManager';
import type { ConnectorConnection, ConnectorMapping, ConnectorCurrentValue, ConnectorStatus } from '../../web/src/api';

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

// ─── ProtocolSelector ─────────────────────────────────────────────────────────

describe('ProtocolSelector', () => {
  it('renders all protocol options', () => {
    render(<ProtocolSelector onSelect={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText('Select Siemens S7 protocol')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Modbus TCP protocol')).toBeInTheDocument();
    expect(screen.getByLabelText('Select EtherNet/IP protocol')).toBeInTheDocument();
  });

  it('calls onSelect with "s7" when S7 option is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProtocolSelector onSelect={onSelect} onCancel={vi.fn()} />);

    await user.click(screen.getByLabelText('Select Siemens S7 protocol'));
    expect(onSelect).toHaveBeenCalledWith('s7');
  });

  it('calls onSelect with "modbus-tcp" when Modbus option is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProtocolSelector onSelect={onSelect} onCancel={vi.fn()} />);

    await user.click(screen.getByLabelText('Select Modbus TCP protocol'));
    expect(onSelect).toHaveBeenCalledWith('modbus-tcp');
  });

  it('calls onSelect with "ethernet-ip" when EtherNet/IP option is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProtocolSelector onSelect={onSelect} onCancel={vi.fn()} />);

    await user.click(screen.getByLabelText('Select EtherNet/IP protocol'));
    expect(onSelect).toHaveBeenCalledWith('ethernet-ip');
  });
});

// ─── ConnectionForm ───────────────────────────────────────────────────────────

describe('ConnectionForm', () => {
  const defaultProps = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders host, rack, slot fields for S7 type', () => {
    render(<ConnectionForm type="s7" {...defaultProps} />);

    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(screen.getByLabelText('Rack')).toBeInTheDocument();
    expect(screen.getByLabelText('Slot')).toBeInTheDocument();
  });

  it('renders host, port, unit ID fields for modbus-tcp type', () => {
    render(<ConnectionForm type="modbus-tcp" {...defaultProps} />);

    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
    expect(screen.getByLabelText('Unit ID')).toBeInTheDocument();
  });

  it('renders host, port fields for ethernet-ip type', () => {
    render(<ConnectionForm type="ethernet-ip" {...defaultProps} />);

    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
  });

  it('does not render S7-specific fields for modbus-tcp', () => {
    render(<ConnectionForm type="modbus-tcp" {...defaultProps} />);

    expect(screen.queryByLabelText('Rack')).not.toBeInTheDocument();
  });

  it('does not render modbus-specific Unit ID for S7', () => {
    render(<ConnectionForm type="s7" {...defaultProps} />);

    expect(screen.queryByLabelText('Unit ID')).not.toBeInTheDocument();
  });
});

// ─── ConnectionCard ───────────────────────────────────────────────────────────

describe('ConnectionCard', () => {
  const baseConnection: ConnectorConnection = {
    id: 'conn-1',
    type: 's7',
    name: 'PLC Main',
    params: { host: '192.168.1.10', rack: 0, slot: 1 },
    pollingIntervalMs: 1000,
    reconnectIntervalMs: 5000,
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
  };

  const defaultProps = {
    connection: baseConnection,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders the connection name', () => {
    render(<ConnectionCard {...defaultProps} />);
    expect(screen.getByText('PLC Main')).toBeInTheDocument();
  });

  it('shows green status badge when connected', () => {
    const status: ConnectorStatus = {
      connectionId: 'conn-1',
      state: 'connected',
    };
    render(<ConnectionCard {...defaultProps} status={status} />);

    const badge = screen.getByLabelText('Status: connected');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-success-800');
  });

  it('shows red status badge when error', () => {
    const status: ConnectorStatus = {
      connectionId: 'conn-1',
      state: 'error',
      errorMessage: 'Connection refused',
    };
    render(<ConnectionCard {...defaultProps} status={status} />);

    const badge = screen.getByLabelText('Status: error');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-danger-800');
  });

  it('shows gray status badge when disconnected', () => {
    const status: ConnectorStatus = {
      connectionId: 'conn-1',
      state: 'disconnected',
    };
    render(<ConnectionCard {...defaultProps} status={status} />);

    const badge = screen.getByLabelText('Status: disconnected');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-gray-800');
  });

  it('displays error message when status has errorMessage', () => {
    const status: ConnectorStatus = {
      connectionId: 'conn-1',
      state: 'error',
      errorMessage: 'Timeout connecting to PLC',
    };
    render(<ConnectionCard {...defaultProps} status={status} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Timeout connecting to PLC');
  });
});

// ─── MappingTable ─────────────────────────────────────────────────────────────

describe('MappingTable', () => {
  const mappings: ConnectorMapping[] = [
    {
      id: 'map-1',
      connectionId: 'conn-1',
      nodeId: 'node-1',
      deviceAddress: 'DB1,REAL0',
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'map-2',
      connectionId: 'conn-1',
      nodeId: 'node-2',
      deviceAddress: 'DB1,REAL4',
      createdAt: '2024-01-01T00:00:00Z',
    },
  ];

  const currentValues: ConnectorCurrentValue[] = [
    {
      nodeId: 'node-1',
      deviceAddress: 'DB1,REAL0',
      connectionId: 'conn-1',
      value: 23.5,
      quality: 'good',
      timestamp: '2024-01-01T00:00:00Z',
    },
  ];

  const allNodes = [
    { id: 'node-1', name: 'Temperature' },
    { id: 'node-2', name: 'Pressure' },
  ];

  const defaultProps = {
    connectionId: 'conn-1',
    connectionType: 's7',
    mappings,
    currentValues,
    allNodes,
    onAddMapping: vi.fn(),
    onRemoveMapping: vi.fn(),
  };

  it('displays device address column with values', () => {
    render(<MappingTable {...defaultProps} />);

    expect(screen.getByText('DB1,REAL0')).toBeInTheDocument();
    expect(screen.getByText('DB1,REAL4')).toBeInTheDocument();
  });

  it('displays mapped node names in the table', () => {
    render(<MappingTable {...defaultProps} />);

    // Node names appear both in table cells and in the select dropdown,
    // so verify they appear in a table cell specifically
    const tempCells = screen.getAllByText('Temperature');
    expect(tempCells.length).toBeGreaterThanOrEqual(1);
    expect(tempCells[0].closest('td')).not.toBeNull();

    const pressureCells = screen.getAllByText('Pressure');
    expect(pressureCells.length).toBeGreaterThanOrEqual(1);
    expect(pressureCells[0].closest('td')).not.toBeNull();
  });

  it('displays live values when provided', () => {
    render(<MappingTable {...defaultProps} />);

    expect(screen.getByText('23.5')).toBeInTheDocument();
  });

  it('displays quality indicator for live values', () => {
    render(<MappingTable {...defaultProps} />);

    expect(screen.getByText('good')).toBeInTheDocument();
  });

  it('shows mapping count', () => {
    render(<MappingTable {...defaultProps} />);

    expect(screen.getByText('Mappings (2)')).toBeInTheDocument();
  });
});

// ─── ConnectorsManager (minimal render test) ──────────────────────────────────

describe('ConnectorsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConnectorStatus.mockResolvedValue([]);
  });

  it('shows loading state initially', () => {
    mockedGetConnections.mockReturnValue(new Promise(() => {}));
    render(<ConnectorsManager />, { wrapper: createWrapper() });

    expect(screen.getByText('Loading connections...')).toBeInTheDocument();
  });

  it('renders connection cards when data is available', async () => {
    const connections: ConnectorConnection[] = [
      {
        id: 'conn-1',
        type: 's7',
        name: 'PLC Floor 1',
        params: { host: '192.168.1.10' },
        pollingIntervalMs: 1000,
        reconnectIntervalMs: 5000,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'conn-2',
        type: 'modbus-tcp',
        name: 'Modbus Sensor',
        params: { host: '192.168.1.20', port: 502 },
        pollingIntervalMs: 2000,
        reconnectIntervalMs: 5000,
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    mockedGetConnections.mockResolvedValue(connections);

    const { findByText } = render(<ConnectorsManager />, { wrapper: createWrapper() });

    expect(await findByText('PLC Floor 1')).toBeInTheDocument();
    expect(await findByText('Modbus Sensor')).toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddressSpaceTree from '../../web/src/screens/address-space/AddressSpaceTree';

// Mock the API module
vi.mock('../../web/src/api', () => ({
  getNamespaces: vi.fn(),
  getObjectNodeTree: vi.fn(),
  getNodes: vi.fn(),
}));

import { getNamespaces, getObjectNodeTree, getNodes } from '../../web/src/api';

const mockedGetNamespaces = vi.mocked(getNamespaces);
const mockedgetObjectNodeTree = vi.mocked(getObjectNodeTree);
const mockedGetNodes = vi.mocked(getNodes);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('AddressSpaceTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockedGetNamespaces.mockReturnValue(new Promise(() => {}));
    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });
    expect(screen.getByText(/Loading address space/)).toBeInTheDocument();
  });

  it('shows error state when namespace fetch fails', async () => {
    mockedGetNamespaces.mockRejectedValue(new Error('Connection refused'));
    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load address space/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no namespaces exist', async () => {
    mockedGetNamespaces.mockResolvedValue([]);
    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/No namespaces defined/)).toBeInTheDocument();
    });
  });

  it('renders namespace list', async () => {
    mockedGetNamespaces.mockResolvedValue([
      { id: 'ns-1', name: 'PlantFloor', uri: 'urn:plant', createdAt: '', updatedAt: '' },
      { id: 'ns-2', name: 'Utilities', uri: 'urn:util', createdAt: '', updatedAt: '' },
    ]);
    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('PlantFloor')).toBeInTheDocument();
    });
    expect(screen.getByText('Utilities')).toBeInTheDocument();
  });

  it('expands namespace to show object nodes and nodes', async () => {
    const user = userEvent.setup();
    mockedGetNamespaces.mockResolvedValue([
      { id: 'ns-1', name: 'PlantFloor', uri: 'urn:plant', createdAt: '', updatedAt: '' },
    ]);
    mockedgetObjectNodeTree.mockResolvedValue([
      { id: 'f-1', namespaceId: 'ns-1', parentObjectNodeId: null, name: 'Temperatures', children: [], createdAt: '' },
    ]);
    mockedGetNodes.mockResolvedValue([
      { id: 'n-1', namespaceId: 'ns-1', objectNodeId: null, name: 'RootSensor', dataType: 'Double', createdAt: '', updatedAt: '' },
      { id: 'n-2', namespaceId: 'ns-1', objectNodeId: 'f-1', name: 'TempSensor1', dataType: 'Double', createdAt: '', updatedAt: '' },
    ]);

    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('PlantFloor')).toBeInTheDocument();
    });

    // Click to expand namespace
    await user.click(screen.getByText('PlantFloor'));

    await waitFor(() => {
      expect(screen.getByText('Temperatures')).toBeInTheDocument();
    });
    expect(screen.getByText('RootSensor')).toBeInTheDocument();
  });

  it('renders nested object node hierarchy', async () => {
    const user = userEvent.setup();
    mockedGetNamespaces.mockResolvedValue([
      { id: 'ns-1', name: 'PlantFloor', uri: 'urn:plant', createdAt: '', updatedAt: '' },
    ]);
    mockedgetObjectNodeTree.mockResolvedValue([
      {
        id: 'f-1',
        namespaceId: 'ns-1',
        parentObjectNodeId: null,
        name: 'Devices',
        createdAt: '',
        children: [
          { id: 'f-2', namespaceId: 'ns-1', parentObjectNodeId: 'f-1', name: 'PLC1', children: [], createdAt: '' },
          { id: 'f-3', namespaceId: 'ns-1', parentObjectNodeId: 'f-1', name: 'PLC2', children: [], createdAt: '' },
        ],
      },
    ]);
    mockedGetNodes.mockResolvedValue([
      { id: 'n-1', namespaceId: 'ns-1', objectNodeId: 'f-2', name: 'Motor1Speed', dataType: 'Float', createdAt: '', updatedAt: '' },
    ]);

    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('PlantFloor')).toBeInTheDocument();
    });

    // Expand namespace
    await user.click(screen.getByText('PlantFloor'));

    await waitFor(() => {
      expect(screen.getByText('Devices')).toBeInTheDocument();
    });

    // Expand Devices object node
    await user.click(screen.getByText('Devices'));

    await waitFor(() => {
      expect(screen.getByText('PLC1')).toBeInTheDocument();
      expect(screen.getByText('PLC2')).toBeInTheDocument();
    });
  });

  it('calls onNodeSelect when a node is clicked', async () => {
    const user = userEvent.setup();
    mockedGetNamespaces.mockResolvedValue([
      { id: 'ns-1', name: 'PlantFloor', uri: 'urn:plant', createdAt: '', updatedAt: '' },
    ]);
    mockedgetObjectNodeTree.mockResolvedValue([]);
    mockedGetNodes.mockResolvedValue([
      { id: 'n-1', namespaceId: 'ns-1', objectNodeId: null, name: 'Sensor1', dataType: 'Double', createdAt: '', updatedAt: '' },
    ]);

    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('PlantFloor')).toBeInTheDocument();
    });

    // Expand namespace
    await user.click(screen.getByText('PlantFloor'));

    await waitFor(() => {
      expect(screen.getByText('Sensor1')).toBeInTheDocument();
    });

    // Click the node
    await user.click(screen.getByText('Sensor1'));

    expect(onNodeSelect).toHaveBeenCalledWith({
      node: { id: 'n-1', namespaceId: 'ns-1', objectNodeId: null, name: 'Sensor1', dataType: 'Double', createdAt: '', updatedAt: '' },
      namespaceName: 'PlantFloor',
      objectNodePath: '',
    });
  });

  it('has proper tree ARIA role', async () => {
    mockedGetNamespaces.mockResolvedValue([
      { id: 'ns-1', name: 'PlantFloor', uri: 'urn:plant', createdAt: '', updatedAt: '' },
    ]);
    const onNodeSelect = vi.fn();
    render(<AddressSpaceTree onNodeSelect={onNodeSelect} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Address Space' })).toBeInTheDocument();
    });
  });
});

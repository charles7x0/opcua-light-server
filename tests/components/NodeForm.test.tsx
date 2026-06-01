import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeForm } from '../../web/src/components/NodeForm';
import { ApiError } from '../../web/src/api';

// Mock the API module
vi.mock('../../web/src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../web/src/api')>();
  return {
    ...actual,
    getNamespaces: vi.fn(),
    getObjectNodeTree: vi.fn(),
    createNode: vi.fn(),
    updateNode: vi.fn(),
  };
});

import { getNamespaces, getObjectNodeTree, createNode, updateNode } from '../../web/src/api';

const mockedGetNamespaces = vi.mocked(getNamespaces);
const mockedgetObjectNodeTree = vi.mocked(getObjectNodeTree);
const mockedCreateNode = vi.mocked(createNode);
const mockedUpdateNode = vi.mocked(updateNode);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('NodeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetNamespaces.mockResolvedValue([
      { id: 'ns-1', name: 'PlantFloor', uri: 'urn:plant', createdAt: '', updatedAt: '' },
      { id: 'ns-2', name: 'Utilities', uri: 'urn:util', createdAt: '', updatedAt: '' },
    ]);
    mockedgetObjectNodeTree.mockResolvedValue([]);
  });

  it('renders create form with required fields', async () => {
    render(<NodeForm />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'Create Node' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Data Type/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Namespace/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Parent Object/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Initial Value/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Node' })).toBeInTheDocument();
  });

  it('renders edit form when node prop is provided', async () => {
    const existingNode = {
      id: 'n-1',
      namespaceId: 'ns-1',
      objectNodeId: null,
      name: 'Sensor1',
      dataType: 'Double',
      initialValue: '25.5',
      description: 'Temperature sensor',
      createdAt: '',
      updatedAt: '',
    };

    render(<NodeForm node={existingNode} />, { wrapper: createWrapper() });

    expect(screen.getByText('Edit Node')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sensor1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25.5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Temperature sensor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Node' })).toBeInTheDocument();
  });

  it('shows validation error when name is empty on submit', async () => {
    const user = userEvent.setup();
    render(<NodeForm />, { wrapper: createWrapper() });

    // Wait for namespaces to load (auto-selects first)
    await waitFor(() => {
      expect(mockedGetNamespaces).toHaveBeenCalled();
    });

    // Submit without filling name
    const submitButton = screen.getByRole('button', { name: 'Create Node' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    // createNode should NOT have been called
    expect(mockedCreateNode).not.toHaveBeenCalled();
  });

  it('shows validation error when namespace is not selected', async () => {
    const user = userEvent.setup();
    // Return empty namespaces so none is auto-selected
    mockedGetNamespaces.mockResolvedValue([]);

    render(<NodeForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockedGetNamespaces).toHaveBeenCalled();
    });

    // Fill in name but leave namespace empty
    const nameInput = screen.getByRole('textbox', { name: /^Name/ });
    await user.type(nameInput, 'TestNode');

    const submitButton = screen.getByRole('button', { name: 'Create Node' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Namespace is required')).toBeInTheDocument();
    });

    expect(mockedCreateNode).not.toHaveBeenCalled();
  });

  it('displays API validation errors adjacent to fields', async () => {
    const user = userEvent.setup();
    mockedCreateNode.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', [
        { field: 'name', message: 'Duplicate name within namespace' },
      ])
    );

    render(<NodeForm />, { wrapper: createWrapper() });

    // Wait for namespaces to load
    await waitFor(() => {
      expect(mockedGetNamespaces).toHaveBeenCalled();
    });

    // Fill in the form
    const nameInput = screen.getByRole('textbox', { name: /^Name/ });
    await user.type(nameInput, 'DuplicateSensor');

    const submitButton = screen.getByRole('button', { name: 'Create Node' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Duplicate name within namespace')).toBeInTheDocument();
    });
  });

  it('displays general API error message', async () => {
    const user = userEvent.setup();
    mockedCreateNode.mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', 'Database connection lost')
    );

    render(<NodeForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockedGetNamespaces).toHaveBeenCalled();
    });

    const nameInput = screen.getByRole('textbox', { name: /^Name/ });
    await user.type(nameInput, 'TestNode');

    const submitButton = screen.getByRole('button', { name: 'Create Node' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Database connection lost')).toBeInTheDocument();
    });
  });

  it('calls createNode with correct data on valid submission', async () => {
    const user = userEvent.setup();
    mockedCreateNode.mockResolvedValue({
      id: 'n-new',
      namespaceId: 'ns-1',
      objectNodeId: null,
      name: 'NewSensor',
      dataType: 'Double',
      initialValue: '0',
      createdAt: '',
      updatedAt: '',
    });

    const onSuccess = vi.fn();
    render(<NodeForm onSuccess={onSuccess} />, { wrapper: createWrapper() });

    // Wait for namespaces to load (auto-selects ns-1)
    await waitFor(() => {
      expect(mockedGetNamespaces).toHaveBeenCalled();
    });

    const nameInput = screen.getByRole('textbox', { name: /^Name/ });
    await user.type(nameInput, 'NewSensor');

    const initialValueInput = screen.getByLabelText(/Initial Value/);
    await user.type(initialValueInput, '42.5');

    const submitButton = screen.getByRole('button', { name: 'Create Node' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockedCreateNode).toHaveBeenCalledWith({
        name: 'NewSensor',
        namespaceId: 'ns-1',
        objectNodeId: undefined,
        dataType: 'Double',
        initialValue: '42.5',
        description: undefined,
      });
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<NodeForm onCancel={onCancel} />, { wrapper: createWrapper() });

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not show cancel button when onCancel is not provided', () => {
    render(<NodeForm />, { wrapper: createWrapper() });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});

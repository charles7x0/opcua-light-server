import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dashboard } from '../../web/src/components/Dashboard';

// Mock the API module
vi.mock('../../web/src/api', () => ({
  getServerStatus: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
  reloadServer: vi.fn(),
}));

import { getServerStatus, startServer, stopServer, reloadServer } from '../../web/src/api';

const mockedGetServerStatus = vi.mocked(getServerStatus);
const mockedStartServer = vi.mocked(startServer);
const mockedStopServer = vi.mocked(stopServer);
const mockedReloadServer = vi.mocked(reloadServer);

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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockedGetServerStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('Loading server status...')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockedGetServerStatus.mockRejectedValue(new Error('Network error'));
    render(<Dashboard />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch server status/)).toBeInTheDocument();
    });
  });

  it('renders running status with uptime and client count', async () => {
    mockedGetServerStatus.mockResolvedValue({
      state: 'running',
      uptime: 3661, // 1h 1m 1s
      pid: 12345,
      connectedClients: 3,
    });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    expect(screen.getByText('PID: 12345')).toBeInTheDocument();
    expect(screen.getByText('1h 1m 1s')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders stopped status', async () => {
    mockedGetServerStatus.mockResolvedValue({
      state: 'stopped',
    });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    // Uptime and clients should not be shown
    expect(screen.queryByText('Uptime')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected Clients')).not.toBeInTheDocument();
  });

  it('renders error status with error message', async () => {
    mockedGetServerStatus.mockResolvedValue({
      state: 'error',
      lastError: 'Runtime crashed: segfault',
    });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    expect(screen.getByText('Runtime crashed: segfault')).toBeInTheDocument();
  });

  it('disables start button when server is running', async () => {
    mockedGetServerStatus.mockResolvedValue({
      state: 'running',
      uptime: 100,
      connectedClients: 0,
    });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: 'Start' });
    expect(startButton).toBeDisabled();
  });

  it('disables stop button when server is stopped', async () => {
    mockedGetServerStatus.mockResolvedValue({
      state: 'stopped',
    });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).toBeDisabled();
  });

  it('disables reload button when server is not running', async () => {
    mockedGetServerStatus.mockResolvedValue({
      state: 'stopped',
    });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    const reloadButton = screen.getByRole('button', { name: 'Reload' });
    expect(reloadButton).toBeDisabled();
  });

  it('calls startServer when start button is clicked', async () => {
    const user = userEvent.setup();
    mockedGetServerStatus.mockResolvedValue({ state: 'stopped' });
    mockedStartServer.mockResolvedValue({ message: 'Server started' });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: 'Start' });
    await user.click(startButton);

    expect(mockedStartServer).toHaveBeenCalledOnce();
  });

  it('calls stopServer when stop button is clicked', async () => {
    const user = userEvent.setup();
    mockedGetServerStatus.mockResolvedValue({
      state: 'running',
      uptime: 100,
      connectedClients: 0,
    });
    mockedStopServer.mockResolvedValue({ message: 'Server stopped' });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    await user.click(stopButton);

    expect(mockedStopServer).toHaveBeenCalledOnce();
  });

  it('calls reloadServer when reload button is clicked', async () => {
    const user = userEvent.setup();
    mockedGetServerStatus.mockResolvedValue({
      state: 'running',
      uptime: 100,
      connectedClients: 0,
    });
    mockedReloadServer.mockResolvedValue({ message: 'Server reloaded' });

    render(<Dashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    const reloadButton = screen.getByRole('button', { name: 'Reload' });
    await user.click(reloadButton);

    expect(mockedReloadServer).toHaveBeenCalledOnce();
  });
});

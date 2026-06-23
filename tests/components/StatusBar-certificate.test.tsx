import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBar } from '../../web/src/StatusBar';

// Mock the API module
vi.mock('../../web/src/api', () => ({
  getServerStatus: vi.fn(),
  getSecurityConfig: vi.fn(),
  getSystemLogs: vi.fn(),
}));

import { getServerStatus, getSecurityConfig, getSystemLogs } from '../../web/src/api';

const mockedGetServerStatus = vi.mocked(getServerStatus);
const mockedGetSecurityConfig = vi.mocked(getSecurityConfig);
const mockedGetSystemLogs = vi.mocked(getSystemLogs);

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

describe('StatusBar - Certificate Indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetServerStatus.mockResolvedValue({ state: 'running', uptime: 100, connectedClients: 0 });
    mockedGetSystemLogs.mockResolvedValue([]);
  });

  it('shows days in green when > 90', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      mode: 'SignAndEncrypt',
      privateKeyConfigured: true,
      certificateRemainingDays: 365,
    });

    render(<StatusBar />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('🔒 365d')).toBeInTheDocument();
    });

    const indicator = screen.getByText('🔒 365d');
    expect(indicator).toHaveClass('text-green-500');
  });

  it('shows days in yellow when 30–90', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      mode: 'SignAndEncrypt',
      privateKeyConfigured: true,
      certificateRemainingDays: 60,
    });

    render(<StatusBar />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('🔒 60d')).toBeInTheDocument();
    });

    const indicator = screen.getByText('🔒 60d');
    expect(indicator).toHaveClass('text-yellow-500');
  });

  it('shows days in red when 1–29', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      mode: 'SignAndEncrypt',
      privateKeyConfigured: true,
      certificateRemainingDays: 15,
    });

    render(<StatusBar />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('🔒 15d')).toBeInTheDocument();
    });

    const indicator = screen.getByText('🔒 15d');
    expect(indicator).toHaveClass('text-red-500');
  });

  it('shows "Expired" in red when 0', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      mode: 'SignAndEncrypt',
      privateKeyConfigured: true,
      certificateRemainingDays: 0,
    });

    render(<StatusBar />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('🔒 Expired')).toBeInTheDocument();
    });

    const indicator = screen.getByText('🔒 Expired');
    expect(indicator).toHaveClass('text-red-500');
  });

  it('hidden when no certificate data', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      mode: 'None',
      privateKeyConfigured: false,
    });

    render(<StatusBar />, { wrapper: createWrapper() });

    // Wait for status to render (server status loads)
    await waitFor(() => {
      expect(screen.getByText(/Runtime/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/🔒/)).not.toBeInTheDocument();
  });
});

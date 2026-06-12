import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecuritySettings } from '../../web/src/components/SecuritySettings';

// Mock the API module
vi.mock('../../web/src/api', () => ({
  getSecurityConfig: vi.fn(),
  updateSecurityPolicy: vi.fn(),
  uploadCertificate: vi.fn(),
  generateCertificate: vi.fn(),
  getCertificateDownloadUrl: vi.fn(),
  browseFiles: vi.fn(),
  getPkiCertificates: vi.fn().mockResolvedValue([]),
  rejectPkiCertificate: vi.fn(),
  trustPkiCertificate: vi.fn(),
  deletePkiCertificate: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    details?: Array<{ field: string; message: string }>;
    constructor(status: number, code: string, message: string, details?: Array<{ field: string; message: string }>) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

import {
  getSecurityConfig,
  updateSecurityPolicy,
  uploadCertificate,
  generateCertificate,
  ApiError,
} from '../../web/src/api';

const mockedGetSecurityConfig = vi.mocked(getSecurityConfig);
const mockedGenerateCertificate = vi.mocked(generateCertificate);

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

const baseConfig = {
  mode: 'None' as const,
  privateKeyConfigured: false,
};

describe('SecuritySettings - Certificate Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Generate Certificate" button', async () => {
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });
  });

  it('shows validation error for invalid DNS names', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });

    const dnsInput = screen.getByLabelText(/DNS Names/);
    await user.type(dnsInput, 'invalid name with spaces!');

    const generateButton = screen.getByRole('button', { name: 'Generate Certificate' });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid DNS name/)).toBeInTheDocument();
    });
  });

  it('shows validation error for invalid IP addresses', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });

    const ipInput = screen.getByLabelText(/IP Addresses/);
    await user.type(ipInput, '999.999.999.999');

    const generateButton = screen.getByRole('button', { name: 'Generate Certificate' });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid IP address/)).toBeInTheDocument();
    });
  });

  it('shows confirmation dialog when certificate already exists', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: true,
    });
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: 'Generate Certificate' });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText('Overwrite Existing Certificate?')).toBeInTheDocument();
    });
  });

  it('shows loading state during generation', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
    // Never resolve to keep pending state
    mockedGenerateCertificate.mockReturnValue(new Promise(() => {}));

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: 'Generate Certificate' });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generating...' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
    });
  });

  it('shows success notification after generation', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
    mockedGenerateCertificate.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: true,
      privateKeyConfigured: true,
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: 'Generate Certificate' });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText('Certificate generated successfully!')).toBeInTheDocument();
    });
  });

  it('shows error message on generation failure', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
    const { ApiError: MockedApiError } = await import('../../web/src/api');
    mockedGenerateCertificate.mockRejectedValue(
      new MockedApiError(500, 'INTERNAL_ERROR', 'Filesystem write failed')
    );

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Certificate' })).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: 'Generate Certificate' });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText('Filesystem write failed')).toBeInTheDocument();
    });
  });
});

describe('SecuritySettings - Certificate Remaining Days Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays green indicator when remaining days > 90', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: true,
      certificateExpiresAt: '2031-06-09T12:00:00.000Z',
      certificateRemainingDays: 365,
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      const daysElement = screen.getByText('365');
      expect(daysElement).toBeInTheDocument();
      expect(daysElement).toHaveClass('text-green-600');
    });
  });

  it('displays yellow indicator when remaining days between 30 and 90', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: true,
      certificateExpiresAt: '2025-08-09T12:00:00.000Z',
      certificateRemainingDays: 60,
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      const daysElement = screen.getByText('60');
      expect(daysElement).toBeInTheDocument();
      expect(daysElement).toHaveClass('text-yellow-600');
    });
  });

  it('displays red indicator when remaining days < 30', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: true,
      certificateExpiresAt: '2025-07-01T12:00:00.000Z',
      certificateRemainingDays: 15,
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      const daysElement = screen.getByText('15');
      expect(daysElement).toBeInTheDocument();
      expect(daysElement).toHaveClass('text-red-600');
    });
  });

  it('displays "Expired" with red indicator when remaining days is 0', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: false,
      certificateExpiresAt: '2024-01-01T12:00:00.000Z',
      certificateRemainingDays: 0,
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      const expiredElement = screen.getByText('Expired');
      expect(expiredElement).toBeInTheDocument();
      expect(expiredElement).toHaveClass('text-red-600');
    });
  });

  it('displays expiry date in YYYY-MM-DD format', async () => {
    mockedGetSecurityConfig.mockResolvedValue({
      ...baseConfig,
      certificatePath: './data/certs/server.der',
      certificateValid: true,
      certificateExpiresAt: '2031-06-09T12:00:00.000Z',
      certificateRemainingDays: 365,
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('2031-06-09')).toBeInTheDocument();
    });
  });

  it('displays "No certificate expiry data available" when no expiry data', async () => {
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('No certificate expiry data available')).toBeInTheDocument();
    });
  });
});

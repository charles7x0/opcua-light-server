import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecuritySettings } from '../../web/src/screens/security/SecuritySettings';

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

import { getSecurityConfig, browseFiles } from '../../web/src/api';

const mockedGetSecurityConfig = vi.mocked(getSecurityConfig);
const mockedBrowseFiles = vi.mocked(browseFiles);

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

describe('SecuritySettings - Browse Buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSecurityConfig.mockResolvedValue(baseConfig);
  });

  it('renders browse button for certificate input', async () => {
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
      expect(browseButtons.length).toBeGreaterThanOrEqual(2);
    });

    // The first Browse button is adjacent to the certificate path input
    const certInput = screen.getByLabelText('Certificate file path');
    expect(certInput).toBeInTheDocument();
    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    expect(browseButtons[0]).toBeInTheDocument();
  });

  it('renders browse button for key input', async () => {
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
      expect(browseButtons.length).toBeGreaterThanOrEqual(2);
    });

    // The second Browse button is adjacent to the private key path input
    const keyInput = screen.getByLabelText('Private key file path');
    expect(keyInput).toBeInTheDocument();
    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    expect(browseButtons[1]).toBeInTheDocument();
  });

  it('certificate browse calls API with correct extensions', async () => {
    const user = userEvent.setup();
    mockedBrowseFiles.mockResolvedValue({ selectedPath: '/path/to/cert.der' });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Browse' })).toHaveLength(2);
    });

    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    await user.click(browseButtons[0]);

    expect(mockedBrowseFiles).toHaveBeenCalledWith({
      extensions: ['.der', '.pem', '.crt'],
    });
  });

  it('key browse calls API with correct extensions', async () => {
    const user = userEvent.setup();
    mockedBrowseFiles.mockResolvedValue({ selectedPath: '/path/to/key.key' });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Browse' })).toHaveLength(2);
    });

    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    await user.click(browseButtons[1]);

    expect(mockedBrowseFiles).toHaveBeenCalledWith({
      extensions: ['.key', '.pem'],
    });
  });

  it('selected cert path populates input', async () => {
    const user = userEvent.setup();
    mockedBrowseFiles.mockResolvedValue({ selectedPath: '/server/certs/server.der' });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Browse' })).toHaveLength(2);
    });

    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    await user.click(browseButtons[0]);

    await waitFor(() => {
      const certInput = screen.getByLabelText('Certificate file path') as HTMLInputElement;
      expect(certInput.value).toBe('/server/certs/server.der');
    });
  });

  it('selected key path populates input', async () => {
    const user = userEvent.setup();
    mockedBrowseFiles.mockResolvedValue({ selectedPath: '/server/certs/server.key' });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Browse' })).toHaveLength(2);
    });

    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    await user.click(browseButtons[1]);

    await waitFor(() => {
      const keyInput = screen.getByLabelText('Private key file path') as HTMLInputElement;
      expect(keyInput.value).toBe('/server/certs/server.key');
    });
  });

  it('cancel leaves input unchanged', async () => {
    const user = userEvent.setup();
    mockedBrowseFiles.mockResolvedValue({ selectedPath: null });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Browse' })).toHaveLength(2);
    });

    // Type something into the cert input first
    const certInput = screen.getByLabelText('Certificate file path') as HTMLInputElement;
    await user.type(certInput, '/existing/path.der');
    expect(certInput.value).toBe('/existing/path.der');

    // Click browse but cancel (returns null)
    const browseButtons = screen.getAllByRole('button', { name: 'Browse' });
    await user.click(browseButtons[0]);

    // Input should remain unchanged
    await waitFor(() => {
      expect(certInput.value).toBe('/existing/path.der');
    });
  });
});

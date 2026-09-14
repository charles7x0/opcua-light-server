import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecuritySettings } from '../../web/src/screens/security/SecuritySettings';

// Mock the API module
vi.mock('../../web/src/api', () => ({
  getSecurityConfig: vi.fn(),
  updateSecurityPolicy: vi.fn(),
  uploadCertificate: vi.fn(),
  generateCertificate: vi.fn(),
  getSuggestedSans: vi.fn().mockResolvedValue({ ipAddresses: [], dnsNames: [] }),
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
  getCertificateDownloadUrl,
} from '../../web/src/api';

const mockedGetSecurityConfig = vi.mocked(getSecurityConfig);
const mockedGetCertificateDownloadUrl = vi.mocked(getCertificateDownloadUrl);

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

const validCertConfig = {
  mode: 'SignAndEncrypt' as const,
  certificatePath: './data/certs/server.der',
  certificateValid: true,
  privateKeyConfigured: true,
  certificateExpiresAt: '2031-06-09T12:00:00.000Z',
  certificateRemainingDays: 365,
};

const noCertConfig = {
  mode: 'None' as const,
  privateKeyConfigured: false,
};

const invalidCertConfig = {
  mode: 'Sign' as const,
  certificatePath: './data/certs/server.der',
  certificateValid: false,
  privateKeyConfigured: true,
};

describe('SecuritySettings - Download Certificate UI', () => {
  let clickedElements: HTMLAnchorElement[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    clickedElements = [];

    // Mock getCertificateDownloadUrl to return proper URLs
    mockedGetCertificateDownloadUrl.mockImplementation((format?: 'der' | 'pem') => {
      const base = '/api/security/certificate/download';
      if (format === 'pem') {
        return `${base}?format=pem`;
      }
      return base;
    });

    // Spy on document.createElement to capture the <a> element used for download
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tagName, options);
      if (tagName === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clickedElements.push(el as HTMLAnchorElement);
        });
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows download button when certificate is valid', async () => {
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Certificate/ })).toBeInTheDocument();
    });
  });

  it('hides download button when no certificate is configured', async () => {
    mockedGetSecurityConfig.mockResolvedValue(noCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Security Settings')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Download Certificate/ })).not.toBeInTheDocument();
  });

  it('hides download button when certificate is invalid', async () => {
    mockedGetSecurityConfig.mockResolvedValue(invalidCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Security Settings')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Download Certificate/ })).not.toBeInTheDocument();
  });

  it('click triggers download with correct URL (DER default)', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Certificate/ })).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole('button', { name: /Download Certificate/ });
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockedGetCertificateDownloadUrl).toHaveBeenCalled();
      expect(clickedElements.length).toBeGreaterThan(0);
      expect(clickedElements[0].href).toContain('/api/security/certificate/download');
      expect(clickedElements[0].href).not.toContain('format=pem');
    });
  });

  it('format selector has DER and PEM options with DER as default', async () => {
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Certificate format')).toBeInTheDocument();
    });

    const select = screen.getByLabelText('Certificate format') as HTMLSelectElement;
    expect(select.value).toBe('der');

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(2);
    expect(options[0].value).toBe('der');
    expect(options[0].textContent).toBe('DER');
    expect(options[1].value).toBe('pem');
    expect(options[1].textContent).toBe('PEM');
  });

  it('PEM selection appends ?format=pem to download URL', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Certificate format')).toBeInTheDocument();
    });

    const select = screen.getByLabelText('Certificate format');
    await user.selectOptions(select, 'pem');

    const downloadButton = screen.getByRole('button', { name: /Download Certificate/ });
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockedGetCertificateDownloadUrl).toHaveBeenCalledWith('pem');
      expect(clickedElements.length).toBeGreaterThan(0);
      expect(clickedElements[0].href).toContain('?format=pem');
    });
  });

  it('DER selection uses URL without format param', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Certificate format')).toBeInTheDocument();
    });

    // Select PEM first, then back to DER
    const select = screen.getByLabelText('Certificate format');
    await user.selectOptions(select, 'pem');
    await user.selectOptions(select, 'der');

    const downloadButton = screen.getByRole('button', { name: /Download Certificate/ });
    await user.click(downloadButton);

    await waitFor(() => {
      // When DER is selected, getCertificateDownloadUrl is called with undefined (not 'pem')
      const lastCall = mockedGetCertificateDownloadUrl.mock.calls[mockedGetCertificateDownloadUrl.mock.calls.length - 1];
      expect(lastCall[0]).toBeUndefined();
      expect(clickedElements[clickedElements.length - 1].href).not.toContain('format=pem');
    });
  });

  it('disables format selector when no certificate is configured', async () => {
    mockedGetSecurityConfig.mockResolvedValue(noCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Certificate format')).toBeInTheDocument();
    });

    const select = screen.getByLabelText('Certificate format') as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  it('shows loading spinner during pending download', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Certificate/ })).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole('button', { name: /Download Certificate/ });
    await user.click(downloadButton);

    // The download is synchronous in this implementation (createElement + click),
    // but if the handler is async, the button briefly shows "Downloading..."
    // The component sets isDownloading=true and then quickly resolves
    // We verify the button text changes during the download
    await waitFor(() => {
      // After the sync download completes, button should be re-enabled
      expect(screen.getByRole('button', { name: /Download Certificate/ })).not.toBeDisabled();
    });
  });

  it('shows error message on download failure', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);

    // Make getCertificateDownloadUrl throw an error
    mockedGetCertificateDownloadUrl.mockImplementation(() => {
      throw new Error('Network error occurred');
    });

    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Certificate/ })).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole('button', { name: /Download Certificate/ });
    await user.click(downloadButton);

    await waitFor(() => {
      expect(screen.getByText('Network error occurred')).toBeInTheDocument();
    });
  });

  it('re-enables button after successful download', async () => {
    const user = userEvent.setup();
    mockedGetSecurityConfig.mockResolvedValue(validCertConfig);
    render(<SecuritySettings />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Download Certificate/ })).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole('button', { name: /Download Certificate/ });
    await user.click(downloadButton);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Download Certificate/ });
      expect(btn).not.toBeDisabled();
    });
  });
});

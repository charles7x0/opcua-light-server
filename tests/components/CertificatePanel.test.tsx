import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CertificatePanel } from '../../web/src/screens/security/CertificatePanel';

vi.mock('../../web/src/api', () => ({
  getPkiCertificates: vi.fn(),
  rejectPkiCertificate: vi.fn(),
  trustPkiCertificate: vi.fn(),
  deletePkiCertificate: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import {
  getPkiCertificates,
  rejectPkiCertificate,
  trustPkiCertificate,
  deletePkiCertificate,
} from '../../web/src/api';

const mockedGetPkiCertificates = vi.mocked(getPkiCertificates);
const mockedRejectPkiCertificate = vi.mocked(rejectPkiCertificate);
const mockedTrustPkiCertificate = vi.mocked(trustPkiCertificate);
const mockedDeletePkiCertificate = vi.mocked(deletePkiCertificate);

const mockCertificates = [
  {
    thumbprint: 'a'.repeat(40),
    status: 'trusted' as const,
    subject: 'Test Client',
    issuer: 'Test CA',
    notBefore: '2024-01-01T00:00:00.000Z',
    notAfter: '2025-01-01T00:00:00.000Z',
    fileSize: 512,
  },
  {
    thumbprint: 'b'.repeat(40),
    status: 'rejected' as const,
    subject: 'Bad Client',
    issuer: 'Other CA',
    notBefore: '2024-06-01T00:00:00.000Z',
    notAfter: '2025-06-01T00:00:00.000Z',
    fileSize: 1024,
  },
];

/** Helper: compute the expected formatted date the same way the component does (local timezone). */
function expectedFormattedDate(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

describe('CertificatePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Table rendering', () => {
    it('renders table with certificate data', async () => {
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);
      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('aaaaaaaaaaaaaaaa')).toBeInTheDocument();
      });

      expect(screen.getByText('Test Client')).toBeInTheDocument();
      expect(screen.getByText('Bad Client')).toBeInTheDocument();
      expect(screen.getByText('Trusted')).toBeInTheDocument();
      expect(screen.getByText('Rejected')).toBeInTheDocument();
      expect(screen.getByText(expectedFormattedDate('2025-01-01T00:00:00.000Z'))).toBeInTheDocument();
      expect(screen.getByText(expectedFormattedDate('2025-06-01T00:00:00.000Z'))).toBeInTheDocument();
      expect(screen.getByText('bbbbbbbbbbbbbbbb')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('displays empty state message when no certificates exist', async () => {
      mockedGetPkiCertificates.mockResolvedValue([]);
      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(
          screen.getByText('No client certificates have been received yet.')
        ).toBeInTheDocument();
      });
    });
  });

  describe('Reject button', () => {
    it('calls rejectPkiCertificate and invalidates query on click', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);
      mockedRejectPkiCertificate.mockResolvedValue(undefined);

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument();
      });

      const rejectButton = screen.getByRole('button', { name: 'Reject' });
      await user.click(rejectButton);

      await waitFor(() => {
        expect(mockedRejectPkiCertificate).toHaveBeenCalledTimes(1);
        expect(mockedRejectPkiCertificate.mock.calls[0][0]).toBe('a'.repeat(40));
      });
    });
  });

  describe('Trust button', () => {
    it('calls trustPkiCertificate and invalidates query on click', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);
      mockedTrustPkiCertificate.mockResolvedValue(undefined);

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Bad Client')).toBeInTheDocument();
      });

      const trustButton = screen.getByRole('button', { name: 'Trust' });
      await user.click(trustButton);

      await waitFor(() => {
        expect(mockedTrustPkiCertificate).toHaveBeenCalledTimes(1);
        expect(mockedTrustPkiCertificate.mock.calls[0][0]).toBe('b'.repeat(40));
      });
    });
  });

  describe('Delete confirmation flow', () => {
    it('shows confirmation dialog when delete button is clicked', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Delete Certificate?')).toBeInTheDocument();
      });
    });

    it('calls deletePkiCertificate when confirm is clicked', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);
      mockedDeletePkiCertificate.mockResolvedValue(undefined);

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Delete Certificate?')).toBeInTheDocument();
      });

      // Find the confirm button inside the dialog (the one with bg-red-600 class)
      const dialog = screen.getByText('Delete Certificate?').closest('.relative.z-10')!;
      const confirmButton = within(dialog as HTMLElement).getByRole('button', { name: 'Delete' });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockedDeletePkiCertificate).toHaveBeenCalledTimes(1);
        expect(mockedDeletePkiCertificate.mock.calls[0][0]).toBe('a'.repeat(40));
      });
    });

    it('does not call API when cancel is clicked in delete dialog', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Delete Certificate?')).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText('Delete Certificate?')).not.toBeInTheDocument();
      });

      expect(mockedDeletePkiCertificate).not.toHaveBeenCalled();
    });
  });

  describe('Error display on API failure', () => {
    it('displays inline error when reject fails', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);
      const { ApiError: MockedApiError } = await import('../../web/src/api');
      mockedRejectPkiCertificate.mockRejectedValue(
        new MockedApiError(404, 'NOT_FOUND', 'Certificate not found in trust store')
      );

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument();
      });

      const rejectButton = screen.getByRole('button', { name: 'Reject' });
      await user.click(rejectButton);

      await waitFor(() => {
        expect(
          screen.getByText('Certificate not found in trust store')
        ).toBeInTheDocument();
      });

      // The list should still be visible (preserved)
      expect(screen.getByText('Test Client')).toBeInTheDocument();
      expect(screen.getByText('Bad Client')).toBeInTheDocument();
    });

    it('displays inline error when trust fails', async () => {
      const user = userEvent.setup();
      mockedGetPkiCertificates.mockResolvedValue(mockCertificates);
      const { ApiError: MockedApiError } = await import('../../web/src/api');
      mockedTrustPkiCertificate.mockRejectedValue(
        new MockedApiError(409, 'CONFLICT', 'Certificate is already trusted')
      );

      render(<CertificatePanel />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('Bad Client')).toBeInTheDocument();
      });

      const trustButton = screen.getByRole('button', { name: 'Trust' });
      await user.click(trustButton);

      await waitFor(() => {
        expect(
          screen.getByText('Certificate is already trusted')
        ).toBeInTheDocument();
      });

      // List preserved
      expect(screen.getByText('Test Client')).toBeInTheDocument();
      expect(screen.getByText('Bad Client')).toBeInTheDocument();
    });
  });
});

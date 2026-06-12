import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPkiCertificates,
  rejectPkiCertificate,
  trustPkiCertificate,
  deletePkiCertificate,
  PkiCertificate,
  ApiError,
} from '../api';

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function StatusBadge({ status }: { status: PkiCertificate['status'] }): JSX.Element {
  if (status === 'trusted') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        Trusted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
      Rejected
    </span>
  );
}

export function CertificatePanel(): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: certificates, isLoading, error } = useQuery({
    queryKey: ['pki-certificates'],
    queryFn: getPkiCertificates,
  });

  const rejectMutation = useMutation({
    mutationFn: rejectPkiCertificate,
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pki-certificates'] });
    },
    onError: (err: Error) => {
      setActionError(
        err instanceof ApiError ? err.message : 'Failed to reject certificate'
      );
    },
  });

  const trustMutation = useMutation({
    mutationFn: trustPkiCertificate,
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pki-certificates'] });
    },
    onError: (err: Error) => {
      setActionError(
        err instanceof ApiError ? err.message : 'Failed to trust certificate'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePkiCertificate,
    onSuccess: () => {
      setActionError(null);
      setConfirmingDelete(null);
      queryClient.invalidateQueries({ queryKey: ['pki-certificates'] });
    },
    onError: (err: Error) => {
      setConfirmingDelete(null);
      setActionError(
        err instanceof ApiError ? err.message : 'Failed to delete certificate'
      );
    },
  });

  const handleDeleteClick = (thumbprint: string): void => {
    setConfirmingDelete(thumbprint);
  };

  const handleConfirmDelete = (): void => {
    if (confirmingDelete) {
      deleteMutation.mutate(confirmingDelete);
    }
  };

  const handleCancelDelete = (): void => {
    setConfirmingDelete(null);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Client Certificates</h3>
        <p className="text-sm text-gray-500">Loading certificates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Client Certificates</h3>
        <p className="text-sm text-red-600">
          Failed to load certificates: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  if (!certificates || certificates.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Client Certificates</h3>
        <p className="text-sm text-gray-500">No client certificates have been received yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">Client Certificates</h3>
      {actionError && (
        <p className="mb-3 text-sm text-red-600">{actionError}</p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Thumbprint
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Subject
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Expiry
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {certificates.map((cert) => (
              <tr key={cert.thumbprint}>
                <td className="px-3 py-2 text-sm font-mono text-gray-700">
                  {cert.thumbprint.substring(0, 16)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">
                  {cert.subject}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={cert.status} />
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">
                  {formatDate(cert.notAfter)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {cert.status === 'trusted' && (
                      <button
                        type="button"
                        onClick={() => rejectMutation.mutate(cert.thumbprint)}
                        disabled={rejectMutation.isPending}
                        className="rounded-md bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reject
                      </button>
                    )}
                    {cert.status === 'rejected' && (
                      <button
                        type="button"
                        onClick={() => trustMutation.mutate(cert.thumbprint)}
                        disabled={trustMutation.isPending}
                        className="rounded-md bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Trust
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(cert.thumbprint)}
                      disabled={deleteMutation.isPending}
                      className="rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Dialog */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={handleCancelDelete}
          />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Delete Certificate?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete certificate{' '}
              <span className="font-mono">{confirmingDelete.slice(0, 16)}...</span>?
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

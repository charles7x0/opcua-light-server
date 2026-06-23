import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPkiCertificates,
  rejectPkiCertificate,
  trustPkiCertificate,
  deletePkiCertificate,
  PkiCertificate,
  ApiError,
} from '../../api';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Alert } from '../../components';

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function CertificatePanel(): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: certificates, isLoading, error } = useQuery({
    queryKey: ['pki-certificates'],
    queryFn: getPkiCertificates,
    refetchInterval: 5000,
  });

  const rejectMutation = useMutation({
    mutationFn: rejectPkiCertificate,
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pki-certificates'] });
    },
    onError: (err: Error) => {
      setActionError(err instanceof ApiError ? err.message : 'Failed to reject certificate');
    },
  });

  const trustMutation = useMutation({
    mutationFn: trustPkiCertificate,
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pki-certificates'] });
    },
    onError: (err: Error) => {
      setActionError(err instanceof ApiError ? err.message : 'Failed to trust certificate');
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
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete certificate');
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>Client Certificates</CardHeader>
        <p className="text-sm text-gray-500">Loading certificates...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>Client Certificates</CardHeader>
        <Alert variant="error">
          Failed to load certificates: {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      </Card>
    );
  }

  if (!certificates || certificates.length === 0) {
    return (
      <Card>
        <CardHeader>Client Certificates</CardHeader>
        <p className="text-sm text-gray-500">No client certificates have been received yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>Client Certificates</CardHeader>
      {actionError && <Alert variant="error" className="mb-3">{actionError}</Alert>}
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
                  <Badge variant={cert.status === 'trusted' ? 'green' : 'red'}>
                    {cert.status === 'trusted' ? 'Trusted' : 'Rejected'}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">
                  {formatDate(cert.notAfter)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {cert.status === 'trusted' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => rejectMutation.mutate(cert.thumbprint)}
                        disabled={rejectMutation.isPending}
                        className="text-orange-800 bg-orange-100 hover:bg-orange-200 border-none"
                      >
                        Reject
                      </Button>
                    )}
                    {cert.status === 'rejected' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => trustMutation.mutate(cert.thumbprint)}
                        disabled={trustMutation.isPending}
                        className="text-green-800 bg-green-100 hover:bg-green-200 border-none"
                      >
                        Trust
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmingDelete(cert.thumbprint)}
                      disabled={deleteMutation.isPending}
                      className="text-red-800 bg-red-100 hover:bg-red-200 border-none"
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmingDelete}
        title="Delete Certificate?"
        message={`Are you sure you want to delete certificate ${confirmingDelete?.slice(0, 16) ?? ''}...?`}
        confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (confirmingDelete) deleteMutation.mutate(confirmingDelete);
        }}
        onCancel={() => setConfirmingDelete(null)}
      />
    </Card>
  );
}

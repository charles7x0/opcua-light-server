import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSecurityConfig,
  updateSecurityPolicy,
  uploadCertificate,
  SecurityConfig,
  ApiError,
} from '../api';

const SECURITY_MODES = ['None', 'Sign', 'SignAndEncrypt'] as const;

export function SecuritySettings() {
  const queryClient = useQueryClient();
  const [certificatePath, setCertificatePath] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const {
    data: config,
    isLoading,
    error: fetchError,
  } = useQuery<SecurityConfig>({
    queryKey: ['security'],
    queryFn: getSecurityConfig,
  });

  const policyMutation = useMutation({
    mutationFn: (mode: string) => updateSecurityPolicy(mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      setPolicyError(null);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        setPolicyError(err.message);
      } else {
        setPolicyError('Failed to update security policy');
      }
    },
  });

  const certificateMutation = useMutation({
    mutationFn: () => uploadCertificate(certificatePath, privateKeyPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      setCertificatePath('');
      setPrivateKeyPath('');
      setUploadError(null);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        setUploadError(err.message);
      } else {
        setUploadError('Failed to upload certificate');
      }
    },
  });

  const handleCertificateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!certificatePath.trim() || !privateKeyPath.trim()) {
      setUploadError('Both certificate path and private key path are required');
      return;
    }
    setUploadError(null);
    certificateMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading security configuration...</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-6">
        <p className="text-red-600">
          Failed to load security configuration:{' '}
          {fetchError instanceof Error ? fetchError.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Security Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure OPC UA security mode and certificates.
        </p>
      </div>

      {/* Security Mode Selection */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Security Mode</h3>
        {policyError && (
          <p className="mb-3 text-sm text-red-600">{policyError}</p>
        )}
        <div className="space-y-2">
          {SECURITY_MODES.map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-3 cursor-pointer"
            >
              <input
                type="radio"
                name="securityMode"
                value={mode}
                checked={config?.mode === mode}
                onChange={() => policyMutation.mutate(mode)}
                disabled={policyMutation.isPending}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{mode}</span>
            </label>
          ))}
        </div>
        {policyMutation.isPending && (
          <p className="mt-2 text-xs text-gray-500">Updating policy...</p>
        )}
      </div>

      {/* Certificate Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Certificate Status</h3>
        <dl className="space-y-3">
          <div className="flex items-center gap-2">
            <dt className="text-sm text-gray-500">Certificate:</dt>
            <dd>
              {config?.certificatePath ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      config.certificateValid ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm text-gray-700">
                    {config.certificateValid ? 'Valid' : 'Invalid'}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-gray-400">Not configured</span>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-sm text-gray-500">Private Key:</dt>
            <dd>
              {config?.privateKeyConfigured ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-700">Configured</span>
                </span>
              ) : (
                <span className="text-sm text-gray-400">Not configured</span>
              )}
            </dd>
          </div>
          {config?.certificatePath && (
            <div className="flex items-start gap-2">
              <dt className="text-sm text-gray-500">Path:</dt>
              <dd className="text-sm text-gray-700 font-mono break-all">
                {config.certificatePath}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Certificate Upload */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Upload Certificate</h3>
        <form onSubmit={handleCertificateSubmit} className="space-y-4">
          {uploadError && (
            <p className="text-sm text-red-600">{uploadError}</p>
          )}
          <div>
            <label
              htmlFor="certificatePath"
              className="block text-sm text-gray-700 mb-1"
            >
              Certificate file path
            </label>
            <input
              id="certificatePath"
              type="text"
              value={certificatePath}
              onChange={(e) => setCertificatePath(e.target.value)}
              placeholder="/path/to/server.der"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label
              htmlFor="privateKeyPath"
              className="block text-sm text-gray-700 mb-1"
            >
              Private key file path
            </label>
            <input
              id="privateKeyPath"
              type="text"
              value={privateKeyPath}
              onChange={(e) => setPrivateKeyPath(e.target.value)}
              placeholder="/path/to/server.key"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={certificateMutation.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {certificateMutation.isPending ? 'Uploading...' : 'Upload Certificate'}
          </button>
        </form>
      </div>
    </div>
  );
}

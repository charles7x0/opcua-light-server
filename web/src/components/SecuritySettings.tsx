import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSecurityConfig,
  updateSecurityPolicy,
  uploadCertificate,
  generateCertificate,
  getCertificateDownloadUrl,
  browseFiles,
  SecurityConfig,
  ApiError,
} from '../api';
import { CertificatePanel } from './CertificatePanel';

const SECURITY_MODES = ['None', 'Sign', 'SignAndEncrypt'] as const;

const DNS_REGEX = /^[a-zA-Z0-9.-]+$/;
const MAX_DNS_LENGTH = 253;
const MAX_SAN_ENTRIES = 20;

function isValidDnsName(dns: string): boolean {
  const trimmed = dns.trim();
  if (!trimmed || trimmed.length > MAX_DNS_LENGTH) return false;
  return DNS_REGEX.test(trimmed);
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return /^\d{1,3}$/.test(part) && num >= 0 && num <= 255;
  });
}

function isValidIpv6(ip: string): boolean {
  const trimmed = ip.trim();
  // Basic IPv6 check: contains colons and valid hex chars
  if (!trimmed.includes(':')) return false;
  // Allow compressed form (::) and full form
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 8) return false;
  const hasDoubleColon = trimmed.includes('::');
  if (hasDoubleColon && (trimmed.match(/::/g) || []).length > 1) return false;
  return parts.every((part) => part === '' || /^[0-9a-fA-F]{1,4}$/.test(part));
}

function isValidIpAddress(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

function parseMultiInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface GenerateFormErrors {
  dnsNames?: string;
  ipAddresses?: string;
}

export function SecuritySettings() {
  const queryClient = useQueryClient();
  const [certificatePath, setCertificatePath] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // Generate certificate form state
  const [dnsNamesInput, setDnsNamesInput] = useState('');
  const [ipAddressesInput, setIpAddressesInput] = useState('');
  const [generateErrors, setGenerateErrors] = useState<GenerateFormErrors>({});
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Download certificate state
  const [downloadFormat, setDownloadFormat] = useState<'der' | 'pem'>('der');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  const generateMutation = useMutation({
    mutationFn: (options: Parameters<typeof generateCertificate>[0]) =>
      generateCertificate(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      setDnsNamesInput('');
      setIpAddressesInput('');
      setGenerateError(null);
      setGenerateErrors({});
      setGenerateSuccess(true);
      setTimeout(() => setGenerateSuccess(false), 5000);
    },
    onError: (err: Error) => {
      setGenerateSuccess(false);
      if (err instanceof ApiError) {
        setGenerateError(err.message);
      } else {
        setGenerateError('Failed to generate certificate');
      }
    },
  });

  const handleBrowseCertificate = async () => {
    const result = await browseFiles({ extensions: ['.der', '.pem', '.crt'] });
    if (result.selectedPath !== null) {
      setCertificatePath(result.selectedPath);
    }
  };

  const handleBrowsePrivateKey = async () => {
    const result = await browseFiles({ extensions: ['.key', '.pem'] });
    if (result.selectedPath !== null) {
      setPrivateKeyPath(result.selectedPath);
    }
  };

  const handleCertificateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!certificatePath.trim() || !privateKeyPath.trim()) {
      setUploadError('Both certificate path and private key path are required');
      return;
    }
    setUploadError(null);
    certificateMutation.mutate();
  };

  const validateGenerateForm = (): GenerateFormErrors => {
    const errors: GenerateFormErrors = {};

    if (dnsNamesInput.trim()) {
      const entries = parseMultiInput(dnsNamesInput);
      if (entries.length > MAX_SAN_ENTRIES) {
        errors.dnsNames = `Maximum ${MAX_SAN_ENTRIES} DNS entries allowed`;
      } else {
        const invalid = entries.filter((e) => !isValidDnsName(e));
        if (invalid.length > 0) {
          errors.dnsNames = `Invalid DNS name(s): ${invalid.join(', ')}`;
        }
      }
    }

    if (ipAddressesInput.trim()) {
      const entries = parseMultiInput(ipAddressesInput);
      if (entries.length > MAX_SAN_ENTRIES) {
        errors.ipAddresses = `Maximum ${MAX_SAN_ENTRIES} IP entries allowed`;
      } else {
        const invalid = entries.filter((e) => !isValidIpAddress(e));
        if (invalid.length > 0) {
          errors.ipAddresses = `Invalid IP address(es): ${invalid.join(', ')}`;
        }
      }
    }

    return errors;
  };

  const buildGenerateOptions = (force = false): Parameters<typeof generateCertificate>[0] => {
    const options: Parameters<typeof generateCertificate>[0] = {};

    const dnsEntries = parseMultiInput(dnsNamesInput);
    if (dnsEntries.length > 0) {
      options.dnsNames = dnsEntries;
    }

    const ipEntries = parseMultiInput(ipAddressesInput);
    if (ipEntries.length > 0) {
      options.ipAddresses = ipEntries;
    }

    if (force) {
      options.force = true;
    }

    return options;
  };

  const handleGenerateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGenerateError(null);
    setGenerateSuccess(false);

    const errors = validateGenerateForm();
    setGenerateErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    // If a certificate already exists, show confirmation dialog
    if (config?.certificatePath) {
      setShowConfirmDialog(true);
      return;
    }

    generateMutation.mutate(buildGenerateOptions());
  };

  const handleConfirmOverwrite = () => {
    setShowConfirmDialog(false);
    generateMutation.mutate(buildGenerateOptions(true));
  };

  const handleCancelOverwrite = () => {
    setShowConfirmDialog(false);
  };

  const handleDownloadCertificate = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const url = getCertificateDownloadUrl(downloadFormat === 'pem' ? 'pem' : undefined);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Failed to download certificate'
      );
    } finally {
      setIsDownloading(false);
    }
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

      {/* Certificate Expiry */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Certificate Expiry</h3>
        {config?.certificateExpiresAt != null && config?.certificateRemainingDays != null ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <dt className="text-sm text-gray-500">Remaining Days:</dt>
              <dd>
                {config.certificateRemainingDays === 0 ? (
                  <span className="text-sm font-semibold text-red-600">Expired</span>
                ) : config.certificateRemainingDays < 30 ? (
                  <span className="text-sm font-semibold text-red-600">
                    {config.certificateRemainingDays}
                  </span>
                ) : config.certificateRemainingDays <= 90 ? (
                  <span className="text-sm font-semibold text-yellow-600">
                    {config.certificateRemainingDays}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-green-600">
                    {config.certificateRemainingDays}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-sm text-gray-500">Expires At:</dt>
              <dd className="text-sm text-gray-700">
                {config.certificateExpiresAt.split('T')[0]}
              </dd>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No certificate expiry data available</p>
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

        {/* Download Certificate Controls */}
        <div className="mt-4 flex items-center gap-3">
          <select
            value={downloadFormat}
            onChange={(e) => setDownloadFormat(e.target.value as 'der' | 'pem')}
            disabled={!config?.certificatePath || !config?.certificateValid}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Certificate format"
          >
            <option value="der">DER</option>
            <option value="pem">PEM</option>
          </select>
          {config?.certificatePath && config?.certificateValid && (
            <button
              type="button"
              onClick={handleDownloadCertificate}
              disabled={isDownloading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading && (
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {isDownloading ? 'Downloading...' : 'Download Certificate'}
            </button>
          )}
        </div>
        {downloadError && (
          <p className="mt-2 text-sm text-red-600">{downloadError}</p>
        )}
      </div>

      {/* Generate Certificate */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Generate Certificate</h3>
        <form onSubmit={handleGenerateSubmit} className="space-y-4">
          {generateError && (
            <p className="text-sm text-red-600">{generateError}</p>
          )}
          {generateSuccess && (
            <p className="text-sm text-green-600">Certificate generated successfully!</p>
          )}
          <div>
            <label
              htmlFor="dnsNames"
              className="block text-sm text-gray-700 mb-1"
            >
              DNS Names <span className="text-gray-400">(optional, comma-separated or one per line)</span>
            </label>
            <textarea
              id="dnsNames"
              value={dnsNamesInput}
              onChange={(e) => {
                setDnsNamesInput(e.target.value);
                if (generateErrors.dnsNames) {
                  setGenerateErrors((prev) => ({ ...prev, dnsNames: undefined }));
                }
              }}
              placeholder="server.example.com, opcua.local"
              rows={3}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:ring-1 ${
                generateErrors.dnsNames
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
              }`}
            />
            {generateErrors.dnsNames && (
              <p className="mt-1 text-xs text-red-600">{generateErrors.dnsNames}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="ipAddresses"
              className="block text-sm text-gray-700 mb-1"
            >
              IP Addresses <span className="text-gray-400">(optional, comma-separated or one per line)</span>
            </label>
            <textarea
              id="ipAddresses"
              value={ipAddressesInput}
              onChange={(e) => {
                setIpAddressesInput(e.target.value);
                if (generateErrors.ipAddresses) {
                  setGenerateErrors((prev) => ({ ...prev, ipAddresses: undefined }));
                }
              }}
              placeholder="192.168.1.100, 10.0.0.1"
              rows={3}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:ring-1 ${
                generateErrors.ipAddresses
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
              }`}
            />
            {generateErrors.ipAddresses && (
              <p className="mt-1 text-xs text-red-600">{generateErrors.ipAddresses}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={generateMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generateMutation.isPending && (
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {generateMutation.isPending ? 'Generating...' : 'Generate Certificate'}
          </button>
        </form>
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
            <div className="flex gap-2">
              <input
                id="certificatePath"
                type="text"
                value={certificatePath}
                onChange={(e) => setCertificatePath(e.target.value)}
                placeholder="/path/to/server.der"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleBrowseCertificate}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Browse
              </button>
            </div>
          </div>
          <div>
            <label
              htmlFor="privateKeyPath"
              className="block text-sm text-gray-700 mb-1"
            >
              Private key file path
            </label>
            <div className="flex gap-2">
              <input
                id="privateKeyPath"
                type="text"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="/path/to/server.key"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleBrowsePrivateKey}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Browse
              </button>
            </div>
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

      {/* Client Certificate Trust Management */}
      <CertificatePanel />

      {/* Overwrite Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={handleCancelOverwrite}
          />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Overwrite Existing Certificate?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              A certificate already exists. Generating a new certificate will overwrite the
              existing certificate and private key files. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelOverwrite}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOverwrite}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Overwrite Certificate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

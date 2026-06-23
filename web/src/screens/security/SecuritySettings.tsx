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
} from '../../api';
import { CertificatePanel } from './CertificatePanel';
import { Button, Input, Textarea, FormField, Card, CardHeader, Alert, ConfirmDialog } from '../../components';

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
  if (!trimmed.includes(':')) return false;
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
      setPolicyError(err instanceof ApiError ? err.message : 'Failed to update security policy');
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
      setUploadError(err instanceof ApiError ? err.message : 'Failed to upload certificate');
    },
  });

  const generateMutation = useMutation({
    mutationFn: (options: Parameters<typeof generateCertificate>[0]) => generateCertificate(options),
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
      setGenerateError(err instanceof ApiError ? err.message : 'Failed to generate certificate');
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
        const invalid = entries.filter((entry) => !isValidDnsName(entry));
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
        const invalid = entries.filter((entry) => !isValidIpAddress(entry));
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
    if (dnsEntries.length > 0) options.dnsNames = dnsEntries;

    const ipEntries = parseMultiInput(ipAddressesInput);
    if (ipEntries.length > 0) options.ipAddresses = ipEntries;

    if (force) options.force = true;

    return options;
  };

  const handleGenerateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setGenerateError(null);
    setGenerateSuccess(false);

    const errors = validateGenerateForm();
    setGenerateErrors(errors);

    if (Object.keys(errors).length > 0) return;

    if (config?.certificatePath) {
      setShowConfirmDialog(true);
      return;
    }

    generateMutation.mutate(buildGenerateOptions());
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
      setDownloadError(err instanceof Error ? err.message : 'Failed to download certificate');
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
        <Alert variant="error">
          Failed to load security configuration: {fetchError instanceof Error ? fetchError.message : 'Unknown error'}
        </Alert>
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
      <Card>
        <CardHeader>Security Mode</CardHeader>
        {policyError && <Alert variant="error" className="mb-3">{policyError}</Alert>}
        <fieldset>
          <legend className="sr-only">Security Mode</legend>
          <div className="space-y-2">
            {SECURITY_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-3 cursor-pointer">
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
        </fieldset>
        {policyMutation.isPending && (
          <p className="mt-2 text-xs text-gray-500">Updating policy...</p>
        )}
      </Card>

      {/* Certificate Expiry */}
      <Card>
        <CardHeader>Certificate Expiry</CardHeader>
        {config?.certificateExpiresAt != null && config?.certificateRemainingDays != null ? (
          <dl className="space-y-2">
            <div className="flex items-center gap-2">
              <dt className="text-sm text-gray-500">Remaining Days:</dt>
              <dd>
                {config.certificateRemainingDays === 0 ? (
                  <span className="text-sm font-semibold text-red-600">Expired</span>
                ) : config.certificateRemainingDays < 30 ? (
                  <span className="text-sm font-semibold text-red-600">{config.certificateRemainingDays}</span>
                ) : config.certificateRemainingDays <= 90 ? (
                  <span className="text-sm font-semibold text-yellow-600">{config.certificateRemainingDays}</span>
                ) : (
                  <span className="text-sm font-semibold text-green-600">{config.certificateRemainingDays}</span>
                )}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-sm text-gray-500">Expires At:</dt>
              <dd className="text-sm text-gray-700">{config.certificateExpiresAt.split('T')[0]}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">No certificate expiry data available</p>
        )}
      </Card>

      {/* Certificate Status */}
      <Card>
        <CardHeader>Certificate Status</CardHeader>
        <dl className="space-y-3">
          <div className="flex items-center gap-2">
            <dt className="text-sm text-gray-500">Certificate:</dt>
            <dd>
              {config?.certificatePath ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${config.certificateValid ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm text-gray-700">{config.certificateValid ? 'Valid' : 'Invalid'}</span>
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
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
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
              <dd className="text-sm text-gray-700 font-mono break-all">{config.certificatePath}</dd>
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
            <Button onClick={handleDownloadCertificate} loading={isDownloading}>
              Download Certificate
            </Button>
          )}
        </div>
        {downloadError && <Alert variant="error" className="mt-2">{downloadError}</Alert>}
      </Card>

      {/* Generate Certificate */}
      <Card>
        <CardHeader>Generate Certificate</CardHeader>
        <form onSubmit={handleGenerateSubmit} className="space-y-4">
          {generateError && <Alert variant="error">{generateError}</Alert>}
          {generateSuccess && <Alert variant="success">Certificate generated successfully!</Alert>}

          <FormField
            id="dnsNames"
            label="DNS Names"
            description="Optional, comma-separated or one per line"
            error={generateErrors.dnsNames}
          >
            <Textarea
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
              error={!!generateErrors.dnsNames}
            />
          </FormField>

          <FormField
            id="ipAddresses"
            label="IP Addresses"
            description="Optional, comma-separated or one per line"
            error={generateErrors.ipAddresses}
          >
            <Textarea
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
              error={!!generateErrors.ipAddresses}
            />
          </FormField>

          <Button variant="success" type="submit" loading={generateMutation.isPending}>
            {generateMutation.isPending ? 'Generating...' : 'Generate Certificate'}
          </Button>
        </form>
      </Card>

      {/* Certificate Upload */}
      <Card>
        <CardHeader>Upload Certificate</CardHeader>
        <form onSubmit={handleCertificateSubmit} className="space-y-4">
          {uploadError && <Alert variant="error">{uploadError}</Alert>}

          <FormField id="certificatePath" label="Certificate file path">
            <div className="flex gap-2">
              <Input
                id="certificatePath"
                value={certificatePath}
                onChange={(e) => setCertificatePath(e.target.value)}
                placeholder="/path/to/server.der"
                className="flex-1"
              />
              <Button variant="secondary" type="button" onClick={handleBrowseCertificate}>
                Browse
              </Button>
            </div>
          </FormField>

          <FormField id="privateKeyPath" label="Private key file path">
            <div className="flex gap-2">
              <Input
                id="privateKeyPath"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="/path/to/server.key"
                className="flex-1"
              />
              <Button variant="secondary" type="button" onClick={handleBrowsePrivateKey}>
                Browse
              </Button>
            </div>
          </FormField>

          <Button type="submit" loading={certificateMutation.isPending}>
            Upload Certificate
          </Button>
        </form>
      </Card>

      {/* Client Certificate Trust Management */}
      <CertificatePanel />

      {/* Overwrite Confirmation Dialog */}
      <ConfirmDialog
        open={showConfirmDialog}
        title="Overwrite Existing Certificate?"
        message="A certificate already exists. Generating a new certificate will overwrite the existing certificate and private key files. This action cannot be undone."
        confirmLabel="Overwrite Certificate"
        variant="danger"
        onConfirm={() => {
          setShowConfirmDialog(false);
          generateMutation.mutate(buildGenerateOptions(true));
        }}
        onCancel={() => setShowConfirmDialog(false)}
      />
    </div>
  );
}

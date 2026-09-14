import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateCertificate, getSuggestedSans, ApiError } from '../../api';
import { Button, Textarea, FormField, Card, CardHeader, Alert, ConfirmDialog } from '../../components';
import { isValidDnsName, isValidIpAddress, parseMultiInput, MAX_SAN_ENTRIES } from './utils/sanValidation';

interface GenerateFormErrors {
  dnsNames?: string;
  ipAddresses?: string;
}

interface GenerateCertificateCardProps {
  hasCertificate: boolean;
}

export function GenerateCertificateCard({ hasCertificate }: GenerateCertificateCardProps) {
  const queryClient = useQueryClient();
  const [dnsNamesInput, setDnsNamesInput] = useState('');
  const [ipAddressesInput, setIpAddressesInput] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [generateErrors, setGenerateErrors] = useState<GenerateFormErrors>({});
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Load server-suggested SANs (loopback, localhost, interface IPs, CERT_EXTRA_HOSTS)
  // to pre-populate the form so users see sensible defaults instead of empty fields.
  const { data: suggestedSans } = useQuery({
    queryKey: ['security', 'suggested-sans'],
    queryFn: getSuggestedSans,
    staleTime: 5 * 60 * 1000,
  });

  // Seed the inputs once from the suggestions, only if the user has not typed
  // anything yet. This preserves any in-progress edits.
  useEffect(() => {
    if (!suggestedSans || prefilled) return;
    if (dnsNamesInput.trim() === '' && ipAddressesInput.trim() === '') {
      setDnsNamesInput(suggestedSans.dnsNames.join(', '));
      setIpAddressesInput(suggestedSans.ipAddresses.join(', '));
    }
    setPrefilled(true);
  }, [suggestedSans, prefilled, dnsNamesInput, ipAddressesInput]);

  const generateMutation = useMutation({
    mutationFn: (options: Parameters<typeof generateCertificate>[0]) => generateCertificate(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      // Reset the form back to the suggested defaults rather than fully empty.
      setDnsNamesInput(suggestedSans ? suggestedSans.dnsNames.join(', ') : '');
      setIpAddressesInput(suggestedSans ? suggestedSans.ipAddresses.join(', ') : '');
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

  function validateForm(): GenerateFormErrors {
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
  }

  function buildOptions(force = false): Parameters<typeof generateCertificate>[0] {
    const options: Parameters<typeof generateCertificate>[0] = {};
    const dnsEntries = parseMultiInput(dnsNamesInput);
    if (dnsEntries.length > 0) options.dnsNames = dnsEntries;
    const ipEntries = parseMultiInput(ipAddressesInput);
    if (ipEntries.length > 0) options.ipAddresses = ipEntries;
    if (force) options.force = true;
    return options;
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setGenerateError(null);
    setGenerateSuccess(false);

    const errors = validateForm();
    setGenerateErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (hasCertificate) {
      setShowConfirmDialog(true);
      return;
    }

    generateMutation.mutate(buildOptions());
  }

  return (
    <>
      <Card>
        <CardHeader>Generate Certificate</CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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

      <ConfirmDialog
        open={showConfirmDialog}
        title="Overwrite Existing Certificate?"
        message="A certificate already exists. Generating a new certificate will overwrite the existing certificate and private key files. This action cannot be undone."
        confirmLabel="Overwrite Certificate"
        variant="danger"
        onConfirm={() => {
          setShowConfirmDialog(false);
          generateMutation.mutate(buildOptions(true));
        }}
        onCancel={() => setShowConfirmDialog(false)}
      />
    </>
  );
}

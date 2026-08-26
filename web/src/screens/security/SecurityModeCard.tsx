import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSecurityPolicy, generateCertificate, ApiError } from '../../api';
import { Card, CardHeader, Alert, Button } from '../../components';
import { useState } from 'react';

const SECURITY_MODES = [
  { value: 'None', label: 'None', description: 'No signing or encryption (development/testing only)' },
  { value: 'Sign', label: 'Sign', description: 'Messages are signed for integrity, but not encrypted' },
  { value: 'SignAndEncrypt', label: 'Sign & Encrypt', description: 'Full confidentiality and integrity (recommended for production)' },
] as const;

interface SecurityModeCardProps {
  currentMode: string | undefined;
  hasCertificate: boolean;
}

export function SecurityModeCard({ currentMode, hasCertificate }: SecurityModeCardProps) {
  const queryClient = useQueryClient();
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);

  const policyMutation = useMutation({
    mutationFn: (mode: string) => updateSecurityPolicy(mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      setPolicyError(null);
      setPendingMode(null);
    },
    onError: (err: Error) => {
      setPolicyError(err instanceof ApiError ? err.message : 'Failed to update security policy');
    },
  });

  const generateAndApplyMutation = useMutation({
    mutationFn: async (mode: string) => {
      // Generate certificate with auto-detected IPs, then apply the mode
      await generateCertificate({ force: false });
      await updateSecurityPolicy(mode);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      setPolicyError(null);
      setPendingMode(null);
    },
    onError: (err: Error) => {
      setPolicyError(err instanceof ApiError ? err.message : 'Failed to generate certificate and apply policy');
    },
  });

  function handleModeChange(mode: string): void {
    setPolicyError(null);

    if (mode === 'None') {
      policyMutation.mutate(mode);
      return;
    }

    if (!hasCertificate) {
      // Show the inline prompt instead of immediately failing
      setPendingMode(mode);
      return;
    }

    policyMutation.mutate(mode);
  }

  function handleGenerateAndApply(): void {
    if (pendingMode) {
      generateAndApplyMutation.mutate(pendingMode);
    }
  }

  function handleCancelPending(): void {
    setPendingMode(null);
  }

  const isWorking = policyMutation.isPending || generateAndApplyMutation.isPending;

  return (
    <Card>
      <CardHeader>Security Mode</CardHeader>

      {policyError && <Alert variant="error" className="mb-3">{policyError}</Alert>}

      {/* Inline prompt: user tried to select a secure mode without a cert */}
      {pendingMode && !hasCertificate && (
        <div className="mb-4 rounded-md border border-warning-200 bg-warning-50 p-4">
          <p className="text-sm font-medium text-warning-800">
            Certificate required
          </p>
          <p className="mt-1 text-sm text-warning-700">
            <strong>{pendingMode}</strong> mode requires a server certificate. Generate one now with auto-detected settings?
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={handleGenerateAndApply}
              loading={generateAndApplyMutation.isPending}
            >
              Generate & Apply
            </Button>
            <Button size="sm" variant="secondary" onClick={handleCancelPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <fieldset disabled={isWorking}>
        <legend className="sr-only">Security Mode</legend>
        <div className="space-y-3">
          {SECURITY_MODES.map((mode) => {
            const needsCert = mode.value !== 'None' && !hasCertificate;
            return (
              <label
                key={mode.value}
                className={`flex items-start gap-3 cursor-pointer rounded-md border p-3 transition-colors ${
                  currentMode === mode.value
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="securityMode"
                  value={mode.value}
                  checked={currentMode === mode.value}
                  onChange={() => handleModeChange(mode.value)}
                  disabled={isWorking}
                  className="mt-0.5 h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-gray-900">{mode.label}</span>
                  {needsCert && (
                    <span className="ml-2 text-xs text-warning-600 font-medium">requires certificate</span>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">{mode.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {isWorking && (
        <p className="mt-3 text-xs text-gray-500">
          {generateAndApplyMutation.isPending
            ? 'Generating certificate and restarting runtime...'
            : 'Updating security mode and restarting runtime...'}
        </p>
      )}
    </Card>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSecurityPolicy, ApiError } from '../../api';
import { Card, CardHeader, Alert } from '../../components';
import { useState } from 'react';

const SECURITY_MODES = ['None', 'Sign', 'SignAndEncrypt'] as const;

interface SecurityModeCardProps {
  currentMode: string | undefined;
}

export function SecurityModeCard({ currentMode }: SecurityModeCardProps) {
  const queryClient = useQueryClient();
  const [policyError, setPolicyError] = useState<string | null>(null);

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

  return (
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
                checked={currentMode === mode}
                onChange={() => policyMutation.mutate(mode)}
                disabled={policyMutation.isPending}
                className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
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
  );
}

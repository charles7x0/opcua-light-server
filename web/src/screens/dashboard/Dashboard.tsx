import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServerStatus, startServer, stopServer, reloadServer, getConnectedClients, ServerStatus } from '../../api';
import { ConnectedClientsTable } from './ConnectedClientsTable';
import { Button, Alert, Card } from '../../components';
import { formatUptime } from '../../utils/formatUptime';

const STATUS_CONFIG: Record<ServerStatus['state'], { label: string; color: string; bgColor: string; dotColor: string }> = {
  running: {
    label: 'Running',
    color: 'text-green-700',
    bgColor: 'bg-green-50 border-green-200',
    dotColor: 'bg-green-500',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-gray-700',
    bgColor: 'bg-gray-50 border-gray-200',
    dotColor: 'bg-gray-400',
  },
  error: {
    label: 'Error',
    color: 'text-red-700',
    bgColor: 'bg-red-50 border-red-200',
    dotColor: 'bg-red-500',
  },
};

export function Dashboard() {
  const queryClient = useQueryClient();

  const { data: status, isLoading, isError } = useQuery({
    queryKey: ['serverStatus'],
    queryFn: getServerStatus,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['server', 'clients'],
    queryFn: getConnectedClients,
    enabled: status?.state === 'running',
  });

  const startMutation = useMutation({
    mutationFn: startServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
      queryClient.invalidateQueries({ queryKey: ['server', 'clients'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: stopServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
      queryClient.invalidateQueries({ queryKey: ['server', 'clients'] });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: reloadServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
      queryClient.invalidateQueries({ queryKey: ['server', 'clients'] });
    },
  });

  const isMutating = startMutation.isPending || stopMutation.isPending || reloadMutation.isPending;

  if (isLoading) {
    return (
      <Card>
        <p className="text-gray-500" role="status" aria-live="polite">Loading server status...</p>
      </Card>
    );
  }

  if (isError || !status) {
    return (
      <Alert variant="error">
        Failed to fetch server status. Is the Control API running?
      </Alert>
    );
  }

  const config = STATUS_CONFIG[status.state];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Server Dashboard</h2>

      {/* Status Card */}
      <div className={`rounded-lg border p-6 ${config.bgColor}`} role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 rounded-full ${config.dotColor}`} aria-hidden="true" />
            <span className={`text-lg font-medium ${config.color}`}>{config.label}</span>
          </div>
          {status.pid && (
            <span className="text-sm text-gray-500">PID: {status.pid}</span>
          )}
        </div>

        {/* Uptime and Clients - shown when running */}
        {status.state === 'running' && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-md bg-white p-3 border border-gray-100" aria-label="Uptime">
              <p className="text-xs text-gray-500 uppercase tracking-wide" aria-hidden="true">Uptime</p>
              <p className="mt-1 text-lg font-medium text-gray-900">
                {status.uptime != null ? formatUptime(status.uptime) : '—'}
              </p>
            </div>
            <div className="rounded-md bg-white p-3 border border-gray-100" aria-label="Connected Clients">
              <p className="text-xs text-gray-500 uppercase tracking-wide" aria-hidden="true">Connected Clients</p>
              <p className="mt-1 text-lg font-medium text-gray-900">
                {status.connectedClients ?? 0}
              </p>
            </div>
          </div>
        )}

        {/* Error message */}
        {status.state === 'error' && status.lastError && (
          <p className="mt-3 text-sm text-danger-600" role="alert">{status.lastError}</p>
        )}
      </div>

      {/* Connected Clients Table - shown only when server is running */}
      {status.state === 'running' && (
        <section aria-label="Connected clients">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Connected Clients</h3>
          <ConnectedClientsTable sessions={clients} />
        </section>
      )}

      {/* Control Buttons */}
      <div className="flex gap-3" role="group" aria-label="Server controls">
        <Button
          variant="success"
          onClick={() => startMutation.mutate()}
          disabled={status.state === 'running' || isMutating}
          loading={startMutation.isPending}
        >
          Start
        </Button>
        <Button
          variant="danger"
          onClick={() => stopMutation.mutate()}
          disabled={status.state === 'stopped' || isMutating}
          loading={stopMutation.isPending}
        >
          Stop
        </Button>
        <Button
          onClick={() => reloadMutation.mutate()}
          disabled={status.state !== 'running' || isMutating}
          loading={reloadMutation.isPending}
        >
          Reload
        </Button>
      </div>

      {/* Mutation feedback */}
      <div aria-live="polite" aria-atomic="true">
        {startMutation.isError && (
          <Alert variant="error">Failed to start server: {startMutation.error.message}</Alert>
        )}
        {stopMutation.isError && (
          <Alert variant="error">Failed to stop server: {stopMutation.error.message}</Alert>
        )}
        {reloadMutation.isError && (
          <Alert variant="error">Failed to reload server: {reloadMutation.error.message}</Alert>
        )}
        {reloadMutation.isSuccess && (
          <Alert variant="success">Server configuration reloaded successfully.</Alert>
        )}
      </div>
    </div>
  );
}

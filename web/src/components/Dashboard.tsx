import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServerStatus, startServer, stopServer, reloadServer, ServerStatus } from '../api';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

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
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: startServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: stopServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: reloadServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverStatus'] });
    },
  });

  const isMutating = startMutation.isPending || stopMutation.isPending || reloadMutation.isPending;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Loading server status...</p>
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="text-red-700">Failed to fetch server status. Is the Control API running?</p>
      </div>
    );
  }

  const config = STATUS_CONFIG[status.state];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Server Dashboard</h2>

      {/* Status Card */}
      <div className={`rounded-lg border p-6 ${config.bgColor}`}>
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
            <div className="rounded-md bg-white p-3 border border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Uptime</p>
              <p className="mt-1 text-lg font-medium text-gray-900">
                {status.uptime != null ? formatUptime(status.uptime) : '—'}
              </p>
            </div>
            <div className="rounded-md bg-white p-3 border border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Connected Clients</p>
              <p className="mt-1 text-lg font-medium text-gray-900">
                {status.connectedClients ?? 0}
              </p>
            </div>
          </div>
        )}

        {/* Error message */}
        {status.state === 'error' && status.lastError && (
          <p className="mt-3 text-sm text-red-600">{status.lastError}</p>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => startMutation.mutate()}
          disabled={status.state === 'running' || isMutating}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </button>
        <button
          onClick={() => stopMutation.mutate()}
          disabled={status.state === 'stopped' || isMutating}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {stopMutation.isPending ? 'Stopping...' : 'Stop'}
        </button>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={status.state !== 'running' || isMutating}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {reloadMutation.isPending ? 'Reloading...' : 'Reload'}
        </button>
      </div>

      {/* Mutation feedback */}
      {startMutation.isError && (
        <p className="text-sm text-red-600">Failed to start server: {startMutation.error.message}</p>
      )}
      {stopMutation.isError && (
        <p className="text-sm text-red-600">Failed to stop server: {stopMutation.error.message}</p>
      )}
      {reloadMutation.isError && (
        <p className="text-sm text-red-600">Failed to reload server: {reloadMutation.error.message}</p>
      )}
      {reloadMutation.isSuccess && (
        <p className="text-sm text-green-600">Server configuration reloaded successfully.</p>
      )}
    </div>
  );
}

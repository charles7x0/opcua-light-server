import { type ServerStatus } from '../../api';
import { useServerControls } from '../../hooks/useServerControls';
import { Button, Badge } from '../../components';
import { formatUptime } from '../../utils/formatUptime';

interface ServerIdentityStripProps {
  status: ServerStatus;
}

const SERVER_STATE_DOT: Record<ServerStatus['state'], string> = {
  running: 'bg-success-500',
  stopped: 'bg-gray-400',
  error: 'bg-danger-500',
};

const SERVER_STATE_LABEL: Record<ServerStatus['state'], string> = {
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

const SERVER_STATE_BADGE: Record<ServerStatus['state'], 'green' | 'gray' | 'red'> = {
  running: 'green',
  stopped: 'gray',
  error: 'red',
};

export function ServerIdentityStrip({ status }: ServerIdentityStripProps) {
  const { start, stop, reload, isMutating, error } = useServerControls();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4" role="region" aria-label="Server identity">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Left: status + metrics */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* State badge */}
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${SERVER_STATE_DOT[status.state]}`} aria-hidden="true" />
            <Badge variant={SERVER_STATE_BADGE[status.state]}>{SERVER_STATE_LABEL[status.state]}</Badge>
          </div>

          {/* PID */}
          {status.pid && (
            <span className="text-xs text-gray-500">PID {status.pid}</span>
          )}

          {/* Uptime */}
          {status.state === 'running' && status.uptime != null && (
            <span className="text-xs text-gray-600">
              <span className="text-gray-400" aria-hidden="true">⏱</span> {formatUptime(status.uptime)}
            </span>
          )}

          {/* Clients */}
          {status.state === 'running' && (
            <span className="text-xs text-gray-600">
              <span className="text-gray-400" aria-hidden="true">👥</span> {status.connectedClients ?? 0} client{(status.connectedClients ?? 0) !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2" role="group" aria-label="Server controls">
          <Button
            variant="success"
            size="xs"
            onClick={() => start.mutate()}
            disabled={status.state === 'running' || isMutating}
            loading={start.isPending}
            aria-label="Start server"
          >
            ▶ Start
          </Button>
          <Button
            variant="danger"
            size="xs"
            onClick={() => stop.mutate()}
            disabled={status.state === 'stopped' || isMutating}
            loading={stop.isPending}
            aria-label="Stop server"
          >
            ■ Stop
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => reload.mutate()}
            disabled={status.state !== 'running' || isMutating}
            loading={reload.isPending}
            aria-label="Reload configuration"
          >
            ↻ Reload
          </Button>
        </div>
      </div>

      {/* Error message */}
      {status.state === 'error' && status.lastError && (
        <p className="mt-2 text-xs text-danger-600" role="alert">{status.lastError}</p>
      )}

      {/* Mutation errors */}
      {error && (
        <p className="mt-2 text-xs text-danger-600" role="alert">{error}</p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConnectorConnection, ConnectorStatus, ConnectorMapping, ConnectorCurrentValue, updateConnection } from '../../api';
import { Button, Badge, ConfirmDialog } from '../../components';
import { type BadgeVariant } from '../../components/styles';
import { MappingTable } from './MappingTable';

interface ConnectionCardProps {
  connection: ConnectorConnection;
  status?: ConnectorStatus;
  onEdit: () => void;
  onDelete: () => void;
  mappings?: ConnectorMapping[];
  currentValues?: ConnectorCurrentValue[];
  allNodes?: Array<{ id: string; name: string }>;
  onAddMapping?: (data: { connectionId: string; nodeId?: string; deviceAddress: string }) => Promise<void>;
  onUpdateMapping?: (id: string, data: { nodeId?: string; deviceAddress?: string }) => Promise<void>;
  onRemoveMapping?: (mappingId: string) => void;
  defaultExpanded?: boolean;
}

const PROTOCOL_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
  's7': { label: 'S7', variant: 'blue' },
  'modbus-tcp': { label: 'Modbus TCP', variant: 'green' },
  'ethernet-ip': { label: 'EtherNet/IP', variant: 'yellow' },
  'pccc': { label: 'PCCC', variant: 'gray' },
};

function getProtocolBadge(type: string): { label: string; variant: BadgeVariant } {
  return PROTOCOL_BADGES[type] ?? { label: type, variant: 'gray' };
}

function getStatusVariant(state?: ConnectorStatus['state']): BadgeVariant {
  switch (state) {
    case 'connected': return 'green';
    case 'error': return 'red';
    case 'disconnected':
    default: return 'gray';
  }
}

function getStatusBorderColor(state?: ConnectorStatus['state'], enabled?: boolean): string {
  if (!enabled) return 'border-l-gray-300';
  switch (state) {
    case 'connected': return 'border-l-green-500';
    case 'error': return 'border-l-red-500';
    case 'disconnected':
    default: return 'border-l-gray-400';
  }
}

/** Extract the host/IP from connection params for display. */
function getConnectionHost(params: Record<string, unknown>): string | null {
  const host = params.host;
  if (typeof host === 'string' && host.trim()) {
    const port = params.port;
    if (typeof port === 'number' && port !== 502 && port !== 44818 && port !== 102) {
      return `${host}:${port}`;
    }
    return host;
  }
  return null;
}

export function ConnectionCard({
  connection,
  status,
  onEdit,
  onDelete,
  mappings = [],
  currentValues = [],
  allNodes = [],
  onAddMapping,
  onUpdateMapping,
  onRemoveMapping,
  defaultExpanded = false,
}: ConnectionCardProps): JSX.Element {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const toggleEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => updateConnection(connection.id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-connections'] });
    },
  });

  const protocol = getProtocolBadge(connection.type);
  const statusState = status?.state ?? 'disconnected';
  const statusVariant = getStatusVariant(status?.state);
  const borderColor = getStatusBorderColor(status?.state, connection.enabled);
  const hostDisplay = getConnectionHost(connection.params);
  const mappingCount = mappings.length;

  return (
    <article
      aria-label={`Connection: ${connection.name}`}
      className={`bg-white rounded-lg border border-gray-200 border-l-4 ${borderColor} overflow-hidden ${!connection.enabled ? 'opacity-60' : ''}`}
    >
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 truncate">{connection.name}</h3>
              {hostDisplay && (
                <span className="text-xs text-gray-500 font-mono truncate">{hostDisplay}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Poll {connection.pollingIntervalMs}ms
              {mappingCount > 0 && <span className="ml-2">{mappingCount} mapping{mappingCount !== 1 ? 's' : ''}</span>}
            </p>
          </div>
          <Badge variant={protocol.variant} aria-label={`Protocol: ${protocol.label}`}>
            {protocol.label}
          </Badge>
          <Badge variant={statusVariant} dot aria-label={`Status: ${statusState}`}>
            {statusState}
          </Badge>
          {status?.errorMessage && (
            <span role="alert" className="text-xs text-danger-600 truncate max-w-[200px]">
              {status.errorMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Enable/disable toggle */}
          <label className="relative inline-flex items-center cursor-pointer" title={connection.enabled ? 'Disable connection' : 'Enable connection'}>
            <input
              type="checkbox"
              className="sr-only peer"
              checked={connection.enabled}
              onChange={() => toggleEnabledMutation.mutate(!connection.enabled)}
              disabled={toggleEnabledMutation.isPending}
              aria-label={`${connection.enabled ? 'Disable' : 'Enable'} connection ${connection.name}`}
            />
            <div className="w-8 h-4 bg-gray-300 peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-600"></div>
          </label>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse mappings' : `Expand mappings (${mappingCount})`}
          >
            {expanded ? '▲' : '▼'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit connection ${connection.name}`}>
            Edit
          </Button>
          <Button variant="danger" size="sm" onClick={() => setIsDeleteOpen(true)} aria-label={`Delete connection ${connection.name}`}>
            Delete
          </Button>
        </div>
      </div>

      {expanded && onAddMapping && onUpdateMapping && onRemoveMapping && (
        <MappingTable
          connectionId={connection.id}
          connectionType={connection.type}
          mappings={mappings}
          currentValues={currentValues}
          allNodes={allNodes}
          onAddMapping={onAddMapping}
          onUpdateMapping={onUpdateMapping}
          onRemoveMapping={onRemoveMapping}
        />
      )}

      <ConfirmDialog
        open={isDeleteOpen}
        title={`Delete "${connection.name}"?`}
        message="Delete this connection and all its mappings? This cannot be undone."
        variant="danger"
        onConfirm={() => { setIsDeleteOpen(false); onDelete(); }}
        onCancel={() => setIsDeleteOpen(false)}
      />
    </article>
  );
}

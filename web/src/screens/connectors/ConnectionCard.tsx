import { useState } from 'react';
import { ConnectorConnection, ConnectorStatus, ConnectorMapping, ConnectorCurrentValue } from '../../api';
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

export function ConnectionCard({ connection, status, onEdit, onDelete, mappings = [], currentValues = [], allNodes = [], onAddMapping, onUpdateMapping, onRemoveMapping }: ConnectionCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const protocol = getProtocolBadge(connection.type);
  const statusState = status?.state ?? 'disconnected';
  const statusVariant = getStatusVariant(status?.state);

  return (
    <article
      aria-label={`Connection: ${connection.name}`}
      className="bg-white rounded-lg border border-gray-200 overflow-hidden"
    >
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{connection.name}</h3>
            <p className="text-xs text-gray-500">
              Poll {connection.pollingIntervalMs}ms · Reconnect {connection.reconnectIntervalMs}ms
            </p>
          </div>
          <Badge variant={protocol.variant} aria-label={`${connection.name} protocol: ${protocol.label}`}>
            {protocol.label}
          </Badge>
          <Badge
            variant={statusVariant}
            dot
            aria-label={`Status: ${statusState}`}
          >
            {statusState}
          </Badge>
          {status?.errorMessage && (
            <span role="alert" className="text-xs text-danger-600">
              {status.errorMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse mappings' : 'Expand mappings'}
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

import { S7Connection, S7ConnectionStatus, S7MappingItem, S7CurrentValue, OpcUaNode } from '../../api';
import { Button, Badge, ConfirmDialog } from '../../components';
import { S7MappingTable } from './S7MappingTable';

interface S7ConnectionCardProps {
  connection: S7Connection;
  status: S7ConnectionStatus | undefined;
  mappings: S7MappingItem[];
  allNodes: OpcUaNode[];
  getNodePath: (node: OpcUaNode) => string;
  currentValues: S7CurrentValue[];
  isDeleteOpen: boolean;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

export function S7ConnectionCard({
  connection,
  status,
  mappings,
  allNodes,
  getNodePath,
  currentValues,
  isDeleteOpen,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: S7ConnectionCardProps) {
  const errorId = `conn-error-${connection.id}`;

  return (
    <article
      aria-label={`S7 connection: ${connection.name}`}
      className="bg-white rounded-lg border border-gray-200 overflow-hidden"
    >
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{connection.name}</h3>
            <p className="text-xs text-gray-500">
              {connection.host} · Rack {connection.rack} · Slot {connection.slot} · Poll {connection.pollingIntervalMs}ms
            </p>
          </div>
          <Badge
            variant={status?.state === 'connected' ? 'green' : status?.state === 'error' ? 'red' : 'gray'}
            dot
            aria-label={`Connection status: ${status?.state ?? 'disconnected'}`}
          >
            {status?.state ?? 'disconnected'}
          </Badge>
          {status?.errorMessage && (
            <span id={errorId} role="alert" className="text-xs text-danger-600">
              {status.errorMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit connection ${connection.name}`}>
            Edit
          </Button>
          <Button variant="danger" size="sm" onClick={onDeleteRequest} aria-label={`Delete connection ${connection.name}`}>
            Delete
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={isDeleteOpen}
        title={`Delete "${connection.name}"?`}
        message="Delete this connection and all its mappings? This cannot be undone."
        variant="danger"
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
      />

      <S7MappingTable
        connection={connection}
        mappings={mappings}
        allNodes={allNodes}
        getNodePath={getNodePath}
        currentValues={currentValues}
      />
    </article>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getConnections,
  getConnectorStatus,
  createConnection,
  updateConnection,
  deleteConnection,
  getMappings,
  createMapping,
  updateMapping,
  deleteMapping,
  getConnectorValues,
  getNodes,
  ConnectorConnection,
  ConnectorStatus,
  ConnectorMapping,
  ConnectorCurrentValue,
  OpcUaNode,
} from '../../api';
import { Button, Badge } from '../../components';
import { type BadgeVariant } from '../../components/styles';
import { useNodePaths } from '../../hooks/useNodePaths';
import { ConnectionCard } from './ConnectionCard';
import { CsvImportExport } from './CsvImportExport';
import { ProtocolSelector } from './ProtocolSelector';
import { ConnectionForm } from './ConnectionForm';

const PROTOCOL_TABS = [
  { label: 'All', value: '' },
  { label: 'S7', value: 's7' },
  { label: 'Modbus TCP', value: 'modbus-tcp' },
  { label: 'EtherNet/IP', value: 'ethernet-ip' },
] as const;

const PROTOCOL_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
  's7': { label: 'S7', variant: 'blue' },
  'modbus-tcp': { label: 'Modbus TCP', variant: 'green' },
  'ethernet-ip': { label: 'EtherNet/IP', variant: 'yellow' },
};

type ProtocolFilter = (typeof PROTOCOL_TABS)[number]['value'];

export function ConnectorsManager(): JSX.Element {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ProtocolFilter>('');
  const [showProtocolSelector, setShowProtocolSelector] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [editingConnection, setEditingConnection] = useState<ConnectorConnection | null>(null);

  const { data: connections = [], isLoading } = useQuery<ConnectorConnection[]>({
    queryKey: ['connectors-connections', filter],
    queryFn: () => getConnections(filter || undefined),
  });

  const { data: statuses = [] } = useQuery<ConnectorStatus[]>({
    queryKey: ['connectors-status'],
    queryFn: getConnectorStatus,
    refetchInterval: 5000,
  });

  const { data: mappings = [] } = useQuery<ConnectorMapping[]>({
    queryKey: ['connectors-mappings'],
    queryFn: () => getMappings(),
  });

  const { data: currentValues = [] } = useQuery<ConnectorCurrentValue[]>({
    queryKey: ['connectors-values'],
    queryFn: getConnectorValues,
    refetchInterval: 2000,
  });

  const { data: allNodes = [] } = useQuery<OpcUaNode[]>({
    queryKey: ['nodes'],
    queryFn: getNodes,
  });

  const { getNodePath } = useNodePaths();

  const createConnectionMutation = useMutation({
    mutationFn: createConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-connections'] });
      resetForm();
    },
  });

  const updateConnectionMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateConnection>[1] }) => updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-connections'] });
      resetForm();
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: deleteConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-connections'] });
      queryClient.invalidateQueries({ queryKey: ['connectors-mappings'] });
    },
  });

  const createMappingMutation = useMutation({
    mutationFn: createMapping,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-mappings'] });
    },
  });

  const updateMappingMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { nodeId?: string; deviceAddress?: string } }) => updateMapping(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-mappings'] });
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: deleteMapping,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-mappings'] });
    },
  });

  function resetForm(): void {
    setShowProtocolSelector(false);
    setSelectedProtocol(null);
    setEditingConnection(null);
  }

  function handleCreateOrUpdate(data: {
    type: string;
    name: string;
    params: Record<string, unknown>;
    pollingIntervalMs?: number;
    reconnectIntervalMs?: number;
    enabled?: boolean;
  }): void {
    if (editingConnection) {
      updateConnectionMutation.mutate({ id: editingConnection.id, data });
    } else {
      createConnectionMutation.mutate(data);
    }
  }

  function handleEdit(conn: ConnectorConnection): void {
    setEditingConnection(conn);
    setSelectedProtocol(conn.type);
    setShowProtocolSelector(true);
  }

  function getStatusForConnection(connectionId: string): ConnectorStatus | undefined {
    return statuses.find((s) => s.connectionId === connectionId);
  }

  if (isLoading) {
    return (
      <div className="p-6" aria-live="polite">
        <p className="text-gray-500">Loading connections...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Connectors</h2>
        <p className="mt-1 text-sm text-gray-500">Manage protocol connections and variable mappings across all connector types.</p>
      </div>

      {/* Protocol filter tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          {PROTOCOL_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filter === tab.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <CsvImportExport onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['connectors-mappings'] })} />
          <Button size="sm" onClick={() => { showProtocolSelector ? resetForm() : setShowProtocolSelector(true); }}>
            {showProtocolSelector ? 'Cancel' : '+ New Connection'}
          </Button>
        </div>
      </div>

      {/* Protocol selector / Connection form */}
      {showProtocolSelector && !selectedProtocol && !editingConnection && (
        <ProtocolSelector onSelect={setSelectedProtocol} onCancel={resetForm} />
      )}
      {(selectedProtocol || editingConnection) && (
        <ConnectionForm
          type={selectedProtocol ?? editingConnection!.type}
          editingConnection={editingConnection}
          onSubmit={handleCreateOrUpdate}
          onCancel={resetForm}
          isSubmitting={createConnectionMutation.isPending || updateConnectionMutation.isPending}
        />
      )}

      {/* Connection cards */}
      {connections.length === 0 && !showProtocolSelector ? (
        <p className="text-sm text-gray-500">No connections configured. Click "+ New Connection" to get started.</p>
      ) : (
        <div className="space-y-4">
          {/* Protocol summary — one badge per unique protocol type for accessibility */}
          <div className="sr-only" aria-label="Active protocols">
            {[...new Set(connections.map((c) => c.type))].map((type) => {
              const badge = PROTOCOL_BADGES[type] ?? { label: type, variant: 'gray' as BadgeVariant };
              return (
                <Badge key={type} variant={badge.variant} aria-label={`Protocol: ${badge.label}`}>
                  {badge.label}
                </Badge>
              );
            })}
          </div>
          {connections.map((conn) => {
            const status = getStatusForConnection(conn.id);
            return (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                status={status}
                onEdit={() => handleEdit(conn)}
                onDelete={() => deleteConnectionMutation.mutate(conn.id)}
                mappings={mappings.filter((m) => m.connectionId === conn.id)}
                currentValues={currentValues.filter((v) => v.connectionId === conn.id)}
                allNodes={allNodes.map((n) => ({ id: n.id, name: getNodePath(n) }))}
                onAddMapping={(data) => createMappingMutation.mutateAsync(data).then(() => {})}
                onUpdateMapping={(id, data) => updateMappingMutation.mutateAsync({ id, data }).then(() => {})}
                onRemoveMapping={(mappingId) => deleteMappingMutation.mutate(mappingId)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

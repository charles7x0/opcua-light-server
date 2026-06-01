import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getS7Connections,
  createS7Connection,
  updateS7Connection,
  deleteS7Connection,
  getS7Mappings,
  createS7Mapping,
  updateS7Mapping,
  createS7MappingsBulk,
  deleteS7Mapping,
  getS7Status,
  getNodes,
  getNamespaces,
  getObjectNodeTree,
  S7Connection,
  S7MappingItem,
  S7ConnectionStatus,
  OpcUaNode,
  ObjectNode,
  Namespace,
  ApiError,
} from '../api';

// ─── Connection Form ──────────────────────────────────────────────────────────

interface ConnectionFormData {
  name: string;
  host: string;
  rack: string;
  slot: string;
  pollingIntervalMs: string;
  reconnectIntervalMs: string;
}

const EMPTY_CONNECTION_FORM: ConnectionFormData = {
  name: '',
  host: '',
  rack: '0',
  slot: '1',
  pollingIntervalMs: '1000',
  reconnectIntervalMs: '5000',
};

// ─── Mapping Form ─────────────────────────────────────────────────────────────

interface MappingFormData {
  connectionId: string;
  nodeId: string;
  plcAddress: string;
}

const EMPTY_MAPPING_FORM: MappingFormData = {
  connectionId: '',
  nodeId: '',
  plcAddress: '',
};

// ─── Status Indicator ─────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: S7ConnectionStatus['state'] }) {
  const styles = {
    connected: 'bg-green-100 text-green-800',
    disconnected: 'bg-gray-100 text-gray-800',
    error: 'bg-red-100 text-red-800',
  };
  const dotStyles = {
    connected: 'bg-green-500',
    disconnected: 'bg-gray-400',
    error: 'bg-red-500',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[state]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[state]}`} />
      {state}
    </span>
  );
}

// ─── Mappings Sub-Component ───────────────────────────────────────────────────

function MappingsSection({
  connections,
  mappings,
  mappingsLoading,
}: {
  connections: S7Connection[];
  mappings: S7MappingItem[];
  mappingsLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [editingMapping, setEditingMapping] = useState<S7MappingItem | null>(null);
  const [formConnectionId, setFormConnectionId] = useState('');
  const [formPlcAddress, setFormPlcAddress] = useState('');
  const [formNodeId, setFormNodeId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkConnectionId, setBulkConnectionId] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Fetch all nodes for the combobox
  const { data: allNodes = [] } = useQuery<OpcUaNode[]>({
    queryKey: ['nodes'],
    queryFn: getNodes,
  });

  // Fetch namespaces and object node trees for hierarchy display
  const { data: namespaces = [] } = useQuery<Namespace[]>({
    queryKey: ['namespaces'],
    queryFn: getNamespaces,
  });

  // Build a map of objectNodeId -> path for display
  const [objectNodePaths, setObjectNodePaths] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    async function loadPaths() {
      const paths = new Map<string, string>();
      for (const ns of namespaces) {
        try {
          const tree = await getObjectNodeTree(ns.id);
          function walk(nodes: ObjectNode[], prefix: string) {
            for (const node of nodes) {
              const path = prefix ? `${prefix} / ${node.name}` : node.name;
              paths.set(node.id, `${ns.name} / ${path}`);
              if (node.children) walk(node.children, path);
            }
          }
          walk(tree, '');
        } catch { /* ignore */ }
      }
      setObjectNodePaths(paths);
    }
    if (namespaces.length > 0) loadPaths();
  }, [namespaces]);

  /** Get display path for a node: "Namespace / ObjectNode / NodeName" */
  function getNodeDisplayPath(node: OpcUaNode): string {
    const ns = namespaces.find((n) => n.id === node.namespaceId);
    const nsName = ns?.name ?? '';
    if (node.objectNodeId) {
      const objPath = objectNodePaths.get(node.objectNodeId);
      return objPath ? `${objPath} / ${node.name}` : `${nsName} / ${node.name}`;
    }
    return `${nsName} / ${node.name}`;
  }

  const createMutation = useMutation({
    mutationFn: () => createS7Mapping({ connectionId: formConnectionId, nodeId: formNodeId, plcAddress: formPlcAddress }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      resetForm();
    },
    onError: (err: Error) => setFormError(err instanceof ApiError ? err.message : 'Failed to create'),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateS7Mapping(editingMapping!.id, { plcAddress: formPlcAddress, nodeId: formNodeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      resetForm();
    },
    onError: (err: Error) => setFormError(err instanceof ApiError ? err.message : 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteS7Mapping,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['s7-mappings'] }),
  });

  const bulkMutation = useMutation({
    mutationFn: (mappingsData: Array<{ connectionId: string; nodeId: string; plcAddress: string }>) =>
      createS7MappingsBulk(mappingsData),
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      const failed = results.filter((r) => !r.success);
      if (failed.length === 0) {
        setShowBulkForm(false);
        setBulkText('');
        setBulkError(null);
      } else {
        setBulkError(`${failed.length} of ${results.length} mappings failed: ${failed.map((f) => f.error).join('; ')}`);
      }
    },
    onError: (err: Error) => setBulkError(err instanceof ApiError ? err.message : 'Bulk create failed'),
  });

  function resetForm() {
    setShowForm(false);
    setEditingMapping(null);
    setFormConnectionId('');
    setFormPlcAddress('');
    setFormNodeId('');
    setFormError(null);
  }

  function startEdit(mapping: S7MappingItem) {
    setEditingMapping(mapping);
    setFormConnectionId(mapping.connectionId);
    setFormPlcAddress(mapping.plcAddress);
    setFormNodeId(mapping.nodeId);
    setShowForm(true);
    setShowBulkForm(false);
    setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formPlcAddress.trim()) { setFormError('PLC address is required'); return; }
    if (!formNodeId) { setFormError('OPC UA node is required'); return; }
    if (!editingMapping && !formConnectionId) { setFormError('Connection is required'); return; }
    setFormError(null);

    if (editingMapping) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bulkConnectionId) { setBulkError('Select a connection'); return; }
    if (!bulkText.trim()) { setBulkError('Enter at least one mapping'); return; }

    // Parse CSV: each line is "plcAddress,nodeName" or "plcAddress,nodeId"
    const lines = bulkText.trim().split('\n').filter((l) => l.trim());
    const mappingsData: Array<{ connectionId: string; nodeId: string; plcAddress: string }> = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 2) { setBulkError(`Invalid line: "${line}". Format: plcAddress,nodeName`); return; }

      const plcAddress = parts[0];
      const nodeRef = parts[1];

      // Try to find node by name first, then by ID
      const node = allNodes.find((n) => n.name === nodeRef) || allNodes.find((n) => n.id === nodeRef);
      if (!node) { setBulkError(`Node not found: "${nodeRef}"`); return; }

      mappingsData.push({ connectionId: bulkConnectionId, nodeId: node.id, plcAddress });
    }

    setBulkError(null);
    bulkMutation.mutate(mappingsData);
  }

  function getNodeName(nodeId: string): string {
    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) return nodeId.slice(0, 8) + '...';
    return getNodeDisplayPath(node);
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h3 className="text-sm font-medium text-gray-900">Variable Mappings</h3>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowBulkForm(!showBulkForm); setShowForm(false); }}
            disabled={connections.length === 0}
            className="rounded-md border border-blue-600 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            {showBulkForm ? 'Cancel Bulk' : 'Bulk Add'}
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setShowBulkForm(false); setEditingMapping(null); setFormConnectionId(''); setFormPlcAddress(''); setFormNodeId(''); }}
            disabled={connections.length === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {showForm && !editingMapping ? 'Cancel' : 'New Mapping'}
          </button>
        </div>
      </div>

      {/* Single Mapping Form (create/edit) */}
      {showForm && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <form onSubmit={handleSubmit} className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-700">{editingMapping ? 'Edit Mapping' : 'New Mapping'}</h4>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Connection</label>
                <select
                  value={formConnectionId}
                  onChange={(e) => setFormConnectionId(e.target.value)}
                  disabled={!!editingMapping}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select connection</option>
                  {connections.map((conn) => (
                    <option key={conn.id} value={conn.id}>{conn.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">PLC Address</label>
                <input
                  type="text"
                  value={formPlcAddress}
                  onChange={(e) => setFormPlcAddress(e.target.value)}
                  placeholder="DB1,REAL0"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">OPC UA Node</label>
                <select
                  value={formNodeId}
                  onChange={(e) => setFormNodeId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select node...</option>
                  {allNodes.map((node) => (
                    <option key={node.id} value={node.id}>{getNodeDisplayPath(node)} ({node.dataType})</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : editingMapping ? 'Update Mapping' : 'Create Mapping'}
            </button>
          </form>
        </div>
      )}

      {/* Bulk Add Form */}
      {showBulkForm && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <form onSubmit={handleBulkSubmit} className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-700">Bulk Add Mappings</h4>
            <p className="text-xs text-gray-500">Enter one mapping per line: <code>PLCAddress,NodeName</code></p>
            {bulkError && <p className="text-sm text-red-600">{bulkError}</p>}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Connection</label>
              <select
                value={bulkConnectionId}
                onChange={(e) => setBulkConnectionId(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select connection</option>
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.id}>{conn.name}</option>
                ))}
              </select>
            </div>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={"DB1,REAL0,Temperature\nDB1,REAL4,Pressure\nDB1,INT8,MotorSpeed"}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={bulkMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {bulkMutation.isPending ? 'Creating...' : 'Create All Mappings'}
            </button>
          </form>
        </div>
      )}

      {/* Mappings Table */}
      {mappingsLoading ? (
        <p className="px-6 py-4 text-sm text-gray-500">Loading mappings...</p>
      ) : mappings.length === 0 ? (
        <p className="px-6 py-4 text-sm text-gray-500">No variable mappings configured.</p>
      ) : (
        <div className="divide-y divide-gray-200">
          {mappings.map((mapping) => {
            const conn = connections.find((c) => c.id === mapping.connectionId);
            return (
              <div key={mapping.id} className="px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500 min-w-[80px]">{conn?.name ?? 'Unknown'}</span>
                  <span className="font-mono text-gray-900">{mapping.plcAddress}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-700">{getNodeName(mapping.nodeId)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => startEdit(mapping)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(mapping.id)}
                    disabled={deleteMutation.isPending}
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function S7ConnectionManager() {
  const queryClient = useQueryClient();
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<S7Connection | null>(null);
  const [connectionForm, setConnectionForm] = useState<ConnectionFormData>(EMPTY_CONNECTION_FORM);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: connections = [], isLoading: connectionsLoading } = useQuery<S7Connection[]>({
    queryKey: ['s7-connections'],
    queryFn: getS7Connections,
  });

  const { data: statuses = [] } = useQuery<S7ConnectionStatus[]>({
    queryKey: ['s7-status'],
    queryFn: getS7Status,
    refetchInterval: 5000,
  });

  const { data: mappings = [], isLoading: mappingsLoading } = useQuery<S7MappingItem[]>({
    queryKey: ['s7-mappings'],
    queryFn: getS7Mappings,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createConnectionMutation = useMutation({
    mutationFn: (data: ConnectionFormData) =>
      createS7Connection({
        name: data.name,
        host: data.host,
        rack: parseInt(data.rack, 10),
        slot: parseInt(data.slot, 10),
        pollingIntervalMs: parseInt(data.pollingIntervalMs, 10),
        reconnectIntervalMs: parseInt(data.reconnectIntervalMs, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-connections'] });
      queryClient.invalidateQueries({ queryKey: ['s7-status'] });
      setConnectionForm(EMPTY_CONNECTION_FORM);
      setShowConnectionForm(false);
      setEditingConnection(null);
      setConnectionError(null);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        setConnectionError(err.message);
      } else {
        setConnectionError('Failed to create connection');
      }
    },
  });

  const updateConnectionMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ConnectionFormData }) =>
      updateS7Connection(id, {
        name: data.name,
        host: data.host,
        rack: parseInt(data.rack, 10),
        slot: parseInt(data.slot, 10),
        pollingIntervalMs: parseInt(data.pollingIntervalMs, 10),
        reconnectIntervalMs: parseInt(data.reconnectIntervalMs, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-connections'] });
      queryClient.invalidateQueries({ queryKey: ['s7-status'] });
      setConnectionForm(EMPTY_CONNECTION_FORM);
      setShowConnectionForm(false);
      setEditingConnection(null);
      setConnectionError(null);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        setConnectionError(err.message);
      } else {
        setConnectionError('Failed to update connection');
      }
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: deleteS7Connection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-connections'] });
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      queryClient.invalidateQueries({ queryKey: ['s7-status'] });
    },
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getStatusForConnection(connectionId: string): S7ConnectionStatus | undefined {
    return statuses.find((s) => s.connectionId === connectionId);
  }

  function handleConnectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!connectionForm.name.trim() || !connectionForm.host.trim()) {
      setConnectionError('Name and host are required');
      return;
    }
    setConnectionError(null);

    if (editingConnection) {
      updateConnectionMutation.mutate({ id: editingConnection.id, data: connectionForm });
    } else {
      createConnectionMutation.mutate(connectionForm);
    }
  }

  function startEditConnection(conn: S7Connection) {
    setEditingConnection(conn);
    setConnectionForm({
      name: conn.name,
      host: conn.host,
      rack: String(conn.rack),
      slot: String(conn.slot),
      pollingIntervalMs: String(conn.pollingIntervalMs),
      reconnectIntervalMs: String(conn.reconnectIntervalMs),
    });
    setShowConnectionForm(true);
    setConnectionError(null);
  }

  function cancelConnectionForm() {
    setShowConnectionForm(false);
    setEditingConnection(null);
    setConnectionForm(EMPTY_CONNECTION_FORM);
    setConnectionError(null);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (connectionsLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading S7 connections...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">S7 Connections</h2>
        <p className="mt-1 text-sm text-gray-500">
          Manage Siemens S7 PLC connections and variable mappings.
        </p>
      </div>

      {/* Connections List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">Connections</h3>
          <button
            onClick={() => {
              if (showConnectionForm) {
                cancelConnectionForm();
              } else {
                setShowConnectionForm(true);
                setEditingConnection(null);
                setConnectionForm(EMPTY_CONNECTION_FORM);
              }
            }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {showConnectionForm ? 'Cancel' : 'New Connection'}
          </button>
        </div>

        {/* New Connection Form */}
        {showConnectionForm && (
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <form onSubmit={handleConnectionSubmit} className="space-y-3">
              {connectionError && (
                <p className="text-sm text-red-600">{connectionError}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="conn-name" className="block text-xs text-gray-600 mb-1">
                    Name
                  </label>
                  <input
                    id="conn-name"
                    type="text"
                    value={connectionForm.name}
                    onChange={(e) => setConnectionForm({ ...connectionForm, name: e.target.value })}
                    placeholder="PLC-1"
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="conn-host" className="block text-xs text-gray-600 mb-1">
                    Host
                  </label>
                  <input
                    id="conn-host"
                    type="text"
                    value={connectionForm.host}
                    onChange={(e) => setConnectionForm({ ...connectionForm, host: e.target.value })}
                    placeholder="192.168.1.10"
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="conn-rack" className="block text-xs text-gray-600 mb-1">
                    Rack
                  </label>
                  <input
                    id="conn-rack"
                    type="number"
                    min="0"
                    value={connectionForm.rack}
                    onChange={(e) => setConnectionForm({ ...connectionForm, rack: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="conn-slot" className="block text-xs text-gray-600 mb-1">
                    Slot
                  </label>
                  <input
                    id="conn-slot"
                    type="number"
                    min="0"
                    value={connectionForm.slot}
                    onChange={(e) => setConnectionForm({ ...connectionForm, slot: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="conn-polling" className="block text-xs text-gray-600 mb-1">
                    Polling Interval (ms)
                  </label>
                  <input
                    id="conn-polling"
                    type="number"
                    min="100"
                    value={connectionForm.pollingIntervalMs}
                    onChange={(e) =>
                      setConnectionForm({ ...connectionForm, pollingIntervalMs: e.target.value })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="conn-reconnect" className="block text-xs text-gray-600 mb-1">
                    Reconnect Interval (ms)
                  </label>
                  <input
                    id="conn-reconnect"
                    type="number"
                    min="1000"
                    value={connectionForm.reconnectIntervalMs}
                    onChange={(e) =>
                      setConnectionForm({ ...connectionForm, reconnectIntervalMs: e.target.value })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={createConnectionMutation.isPending || updateConnectionMutation.isPending}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(createConnectionMutation.isPending || updateConnectionMutation.isPending)
                  ? 'Saving...'
                  : editingConnection
                    ? 'Update Connection'
                    : 'Create Connection'}
              </button>
            </form>
          </div>
        )}

        {/* Connections Table */}
        {connections.length === 0 ? (
          <p className="px-6 py-4 text-sm text-gray-500">No S7 connections configured.</p>
        ) : (
          <div className="divide-y divide-gray-200">
            {connections.map((conn) => {
              const status = getStatusForConnection(conn.id);
              return (
                <div key={conn.id} className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{conn.name}</p>
                      <p className="text-xs text-gray-500">
                        {conn.host} · Rack {conn.rack} · Slot {conn.slot} · Poll{' '}
                        {conn.pollingIntervalMs}ms
                      </p>
                    </div>
                    <StatusBadge state={status?.state ?? 'disconnected'} />
                    {status?.errorMessage && (
                      <span className="text-xs text-red-600">{status.errorMessage}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => startEditConnection(conn)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                      aria-label={`Edit connection ${conn.name}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteConnectionMutation.mutate(conn.id)}
                      disabled={deleteConnectionMutation.isPending}
                      className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                      aria-label={`Delete connection ${conn.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mappings Section */}
      <MappingsSection
        connections={connections}
        mappings={mappings}
        mappingsLoading={mappingsLoading}
      />
    </div>
  );
}

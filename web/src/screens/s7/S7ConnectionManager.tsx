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
  getS7Values,
  exportS7MappingsCsv,
  importS7MappingsCsv,
  getNodes,
  getNamespaces,
  getObjectNodeTree,
  S7Connection,
  S7MappingItem,
  S7ConnectionStatus,
  S7CurrentValue,
  S7MappingImportResult,
  OpcUaNode,
  ObjectNode,
  Namespace,
  ApiError,
} from '../../api';
import { Button, Input, FormField, Badge, Card, CardHeader, Alert, ConfirmDialog, FileButton, Select } from '../../components';
import { downloadTextAsFile } from '../../utils/downloadFile';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectionFormData {
  name: string;
  host: string;
  rack: string;
  slot: string;
  pollingIntervalMs: string;
  reconnectIntervalMs: string;
}

const EMPTY_CONN_FORM: ConnectionFormData = {
  name: '', host: '', rack: '0', slot: '1', pollingIntervalMs: '1000', reconnectIntervalMs: '5000',
};

// ─── Connection Mappings (per connection) ─────────────────────────────────────

function ConnectionMappings({ connection, mappings, allNodes, getNodePath, currentValues }: {
  connection: S7Connection;
  mappings: S7MappingItem[];
  allNodes: OpcUaNode[];
  getNodePath: (node: OpcUaNode) => string;
  currentValues: S7CurrentValue[];
}) {
  const queryClient = useQueryClient();
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  interface EditableRow {
    id: string | null;
    plcAddress: string;
    description: string;
    nodeId: string;
    dirty: boolean;
  }

  const [rows, setRows] = useState<EditableRow[]>([]);

  useEffect(() => {
    setRows((prev) => {
      const mapped: EditableRow[] = mappings.map((m) => {
        const existing = prev.find((r) => r.id === m.id);
        if (existing?.dirty) return existing;
        return { id: m.id, plcAddress: m.plcAddress, description: m.description ?? '', nodeId: m.nodeId, dirty: false };
      });
      const newRows = prev.filter((r) => r.id === null && (r.plcAddress || r.nodeId));
      return [...mapped, ...newRows];
    });
  }, [mappings]);

  function addBlankRow() {
    setRows([...rows, { id: null, plcAddress: '', description: '', nodeId: '', dirty: true }]);
  }

  function updateRow(index: number, field: keyof EditableRow, value: string) {
    const updated = [...rows];
    (updated[index] as any)[field] = value;
    updated[index].dirty = true;
    setRows(updated);
    setSuccessMsg('');
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (row.id === null) {
      setRows(rows.filter((_, i) => i !== index));
    } else {
      setDeleteConfirmId(row.id);
    }
  }

  const hasDirtyRows = rows.some((r) => r.dirty);

  const saveMut = useMutation({
    mutationFn: async () => {
      const dirtyRows = rows.filter((r) => r.dirty);
      const errors: string[] = [];
      for (const row of dirtyRows) {
        if (!row.plcAddress.trim() || !row.nodeId) continue;
        if (row.id === null) {
          try {
            await createS7Mapping({ connectionId: connection.id, nodeId: row.nodeId, plcAddress: row.plcAddress.trim(), description: row.description.trim() || undefined });
          } catch (e) { errors.push(`${row.plcAddress}: ${(e as Error).message}`); }
        } else {
          try {
            await updateS7Mapping(row.id, { plcAddress: row.plcAddress.trim(), nodeId: row.nodeId, description: row.description.trim() || undefined });
          } catch (e) { errors.push(`${row.plcAddress}: ${(e as Error).message}`); }
        }
      }
      if (errors.length > 0) throw new Error(errors.join('\n'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
      setError('');
      setSuccessMsg('Mappings saved successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (e: Error) => { setError(e.message); setSuccessMsg(''); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteS7Mapping,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['s7-mappings'] }); setDeleteConfirmId(null); },
  });

  const bulkMut = useMutation({
    mutationFn: (data: Array<{ connectionId: string; nodeId: string; plcAddress: string }>) => createS7MappingsBulk(data),
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      const failed = results.filter((r) => !r.success);
      if (failed.length === 0) { setShowBulk(false); setBulkText(''); setBulkError(''); }
      else setBulkError(`${failed.length} failed: ${failed.map((f) => f.error).join('; ')}`);
    },
    onError: (e: Error) => setBulkError(e instanceof ApiError ? e.message : 'Failed'),
  });

  function handleBulk(e: React.FormEvent) {
    e.preventDefault();
    if (!bulkText.trim()) { setBulkError('Enter mappings'); return; }
    const lines = bulkText.trim().split('\n').filter((l) => l.trim());
    const data: Array<{ connectionId: string; nodeId: string; plcAddress: string }> = [];
    for (const line of lines) {
      const [addr, ref] = line.split(',').map((s) => s.trim());
      if (!addr || !ref) { setBulkError(`Invalid: "${line}"`); return; }
      const node = allNodes.find((n) => n.name === ref) || allNodes.find((n) => n.id === ref);
      if (!node) { setBulkError(`Node not found: "${ref}"`); return; }
      data.push({ connectionId: connection.id, nodeId: node.id, plcAddress: addr });
    }
    setBulkError('');
    bulkMut.mutate(data);
  }

  return (
    <div className="border-t border-gray-200">
      <div className="px-6 py-3 flex items-center justify-between bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Variable Mappings ({mappings.length})
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="xs" onClick={() => setShowBulk(!showBulk)}>
            {showBulk ? 'Cancel' : '📋 Bulk Import'}
          </Button>
          <Button size="xs" onClick={addBlankRow}>+ Add Row</Button>
          {hasDirtyRows && (
            <Button variant="success" size="xs" onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
              💾 Save All
            </Button>
          )}
        </div>
      </div>

      {error && <div className="px-6 py-2 bg-red-50 border-b border-red-100"><p className="text-xs text-red-600 whitespace-pre-line">{error}</p></div>}
      {successMsg && <div className="px-6 py-2 bg-green-50 border-b border-green-100"><p className="text-xs text-green-700">✓ {successMsg}</p></div>}

      {showBulk && (
        <div className="px-6 py-4 border-b border-gray-100 bg-blue-50/40">
          <form onSubmit={handleBulk} className="space-y-3">
            <p className="text-xs font-medium text-gray-700">Bulk Import</p>
            <p className="text-[11px] text-gray-500">One per line: <code className="bg-gray-100 px-1 rounded">PLCAddress,NodeName</code></p>
            {bulkError && <p className="text-xs text-red-600">{bulkError}</p>}
            <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={4} placeholder={"DB1,REAL0,Temperature\nDB1,REAL4,Pressure"} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
            <div className="flex gap-2">
              <Button size="sm" type="submit" loading={bulkMut.isPending}>Import All</Button>
              <Button variant="secondary" size="sm" type="button" onClick={() => { setShowBulk(false); setBulkError(''); }}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {rows.length === 0 && !showBulk ? (
        <div className="px-6 py-4">
          <p className="text-xs text-gray-400 italic">No variable mappings. Click "+ Add Row" to start.</p>
        </div>
      ) : rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide border-b border-gray-200 bg-gray-50/50">
              <th className="pl-6 pr-2 py-2 font-medium w-[160px]">PLC Address</th>
              <th className="px-2 py-2 font-medium w-[160px]">Description</th>
              <th className="px-2 py-2 font-medium">Node</th>
              <th className="px-2 py-2 font-medium w-[70px]">Type</th>
              <th className="px-2 py-2 font-medium w-[130px]">Current Value</th>
              <th className="px-2 pr-6 py-2 font-medium w-[40px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, idx) => {
              const selectedNode = allNodes.find((n) => n.id === row.nodeId);
              const liveValue = row.id ? currentValues.find((v) => v.nodeId === row.nodeId) : undefined;
              return (
                <tr key={row.id ?? `new-${idx}`} className={`${row.dirty ? 'bg-yellow-50/50' : ''}`}>
                  <td className="pl-6 pr-2 py-1">
                    <Input type="text" inputSize="xs" value={row.plcAddress} onChange={(e) => updateRow(idx, 'plcAddress', e.target.value)} placeholder="DB1,REAL0" className="mt-0 font-mono bg-white" />
                  </td>
                  <td className="px-2 py-1">
                    <Input type="text" inputSize="xs" value={row.description} onChange={(e) => updateRow(idx, 'description', e.target.value)} placeholder="Label..." className="mt-0 bg-white" />
                  </td>
                  <td className="px-2 py-1">
                    <Select selectSize="xs" value={row.nodeId} onChange={(e) => updateRow(idx, 'nodeId', e.target.value)} className="mt-0 bg-white">
                      <option value="">Select...</option>
                      {allNodes.map((n) => <option key={n.id} value={n.id}>{getNodePath(n)}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-center">
                    {selectedNode && <span className="inline-block rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">{selectedNode.dataType}</span>}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {liveValue ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-mono ${liveValue.quality === 'good' ? 'text-gray-900' : 'text-red-500'}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${liveValue.quality === 'good' ? 'bg-green-500' : 'bg-red-500'}`} />
                        {liveValue.value !== undefined && liveValue.value !== null ? String(liveValue.value) : <span className="text-gray-400 italic">—</span>}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-2 pr-6 py-1 text-center">
                    <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600 text-sm" title="Remove row">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {deleteConfirmId && (
        <div className="px-6 py-3 border-t border-gray-100">
          <ConfirmDialog
            open={!!deleteConfirmId}
            title="Delete Mapping?"
            message={`Delete mapping "${mappings.find((m) => m.id === deleteConfirmId)?.plcAddress}"?`}
            variant="danger"
            onConfirm={() => deleteMut.mutate(deleteConfirmId)}
            onCancel={() => setDeleteConfirmId(null)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function S7ConnectionManager() {
  const queryClient = useQueryClient();
  const [showConnForm, setShowConnForm] = useState(false);
  const [editingConn, setEditingConn] = useState<S7Connection | null>(null);
  const [connForm, setConnForm] = useState<ConnectionFormData>(EMPTY_CONN_FORM);
  const [connError, setConnError] = useState('');
  const [deleteConnId, setDeleteConnId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<S7MappingImportResult | null>(null);
  const [importError, setImportError] = useState('');

  const { data: connections = [], isLoading } = useQuery<S7Connection[]>({ queryKey: ['s7-connections'], queryFn: getS7Connections });
  const { data: statuses = [] } = useQuery<S7ConnectionStatus[]>({ queryKey: ['s7-status'], queryFn: getS7Status, refetchInterval: 5000 });
  const { data: mappings = [] } = useQuery<S7MappingItem[]>({ queryKey: ['s7-mappings'], queryFn: getS7Mappings });
  const { data: currentValues = [] } = useQuery<S7CurrentValue[]>({ queryKey: ['s7-values'], queryFn: getS7Values, refetchInterval: 2000 });
  const { data: allNodes = [] } = useQuery<OpcUaNode[]>({ queryKey: ['nodes'], queryFn: getNodes });
  const { data: namespaces = [] } = useQuery<Namespace[]>({ queryKey: ['namespaces'], queryFn: getNamespaces });

  const [objPaths, setObjPaths] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    async function load() {
      const paths = new Map<string, string>();
      for (const ns of namespaces) {
        try {
          const tree = await getObjectNodeTree(ns.id);
          function walk(nodes: ObjectNode[], prefix: string) {
            for (const n of nodes) {
              const p = prefix ? `${prefix} / ${n.name}` : n.name;
              paths.set(n.id, `${ns.name} / ${p}`);
              if (n.children) walk(n.children, p);
            }
          }
          walk(tree, '');
        } catch { /* ignore */ }
      }
      setObjPaths(paths);
    }
    if (namespaces.length > 0) load();
  }, [namespaces]);

  function getNodePath(node: OpcUaNode): string {
    const ns = namespaces.find((n) => n.id === node.namespaceId);
    const nsName = ns?.name ?? '';
    if (node.objectNodeId) {
      const op = objPaths.get(node.objectNodeId);
      return op ? `${op} / ${node.name}` : `${nsName} / ${node.name}`;
    }
    return `${nsName} / ${node.name}`;
  }

  const createConnMut = useMutation({
    mutationFn: (d: ConnectionFormData) => createS7Connection({ name: d.name, host: d.host, rack: parseInt(d.rack), slot: parseInt(d.slot), pollingIntervalMs: parseInt(d.pollingIntervalMs), reconnectIntervalMs: parseInt(d.reconnectIntervalMs) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['s7-connections'] }); queryClient.invalidateQueries({ queryKey: ['s7-status'] }); resetConnForm(); },
    onError: (e: Error) => setConnError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const updateConnMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: ConnectionFormData }) => updateS7Connection(id, { name: d.name, host: d.host, rack: parseInt(d.rack), slot: parseInt(d.slot), pollingIntervalMs: parseInt(d.pollingIntervalMs), reconnectIntervalMs: parseInt(d.reconnectIntervalMs) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['s7-connections'] }); queryClient.invalidateQueries({ queryKey: ['s7-status'] }); resetConnForm(); },
    onError: (e: Error) => setConnError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const deleteConnMut = useMutation({
    mutationFn: deleteS7Connection,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['s7-connections'] }); queryClient.invalidateQueries({ queryKey: ['s7-mappings'] }); queryClient.invalidateQueries({ queryKey: ['s7-status'] }); setDeleteConnId(null); },
  });

  function resetConnForm() { setShowConnForm(false); setEditingConn(null); setConnForm(EMPTY_CONN_FORM); setConnError(''); }

  function startEditConn(c: S7Connection) {
    setEditingConn(c);
    setConnForm({ name: c.name, host: c.host, rack: String(c.rack), slot: String(c.slot), pollingIntervalMs: String(c.pollingIntervalMs), reconnectIntervalMs: String(c.reconnectIntervalMs) });
    setShowConnForm(true); setConnError('');
  }

  function handleConnSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!connForm.name.trim() || !connForm.host.trim()) { setConnError('Name and host required'); return; }
    setConnError('');
    editingConn ? updateConnMut.mutate({ id: editingConn.id, d: connForm }) : createConnMut.mutate(connForm);
  }

  if (isLoading) return <div className="p-6" aria-live="polite"><p className="text-gray-500">Loading S7 connections...</p></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">S7 PLC Connections</h2>
        <p className="mt-1 text-sm text-gray-500">Manage Siemens S7 PLC connections and variable mappings.</p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={async () => {
            setIsExporting(true);
            try {
              const csv = await exportS7MappingsCsv();
              downloadTextAsFile(csv, 's7-mappings.csv');
            } catch (e) { alert('Export failed: ' + (e instanceof Error ? e.message : 'Unknown error')); }
            finally { setIsExporting(false); }
          }} disabled={isExporting}>
            {isExporting ? 'Exporting...' : '📥 Export Mappings CSV'}
          </Button>
          <FileButton accept=".csv,text/csv" disabled={isImporting} size="sm" onFileSelect={async (file) => {
              setIsImporting(true); setImportResult(null); setImportError('');
              try { const text = await file.text(); const result = await importS7MappingsCsv(text); setImportResult(result); queryClient.invalidateQueries({ queryKey: ['s7-mappings'] }); }
              catch (err) { setImportError(err instanceof Error ? err.message : 'Import failed'); }
              finally { setIsImporting(false); }
          }}>
            {isImporting ? 'Importing...' : '📤 Import Mappings CSV'}
          </FileButton>
        </div>
        <Button size="sm" onClick={() => { showConnForm ? resetConnForm() : setShowConnForm(true); }}>
          {showConnForm ? 'Cancel' : '+ New Connection'}
        </Button>
      </div>

      {importResult && (
        <Alert variant={importResult.summary.failed > 0 ? 'warning' : 'success'} onDismiss={() => setImportResult(null)}>
          Import complete: {importResult.summary.succeeded} succeeded, {importResult.summary.failed} failed out of {importResult.summary.total} rows.
          {importResult.summary.failed > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs max-h-32 overflow-y-auto">
              {importResult.results.filter((r) => !r.success).map((r) => (
                <li key={r.row}>Row {r.row}{r.plcAddress ? ` (${r.plcAddress})` : ''}: {r.error}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {importError && <Alert variant="error" onDismiss={() => setImportError('')}>{importError}</Alert>}

      {showConnForm && (
        <Card>
          <CardHeader>{editingConn ? 'Edit Connection' : 'New Connection'}</CardHeader>
          {connError && <Alert variant="error" className="mb-3">{connError}</Alert>}
          <form onSubmit={handleConnSubmit} aria-label={editingConn ? `Edit connection ${editingConn.name}` : 'New S7 connection'} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField id="conn-name" label="Name"><Input id="conn-name" value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} placeholder="PLC-1" /></FormField>
              <FormField id="conn-host" label="Host"><Input id="conn-host" value={connForm.host} onChange={(e) => setConnForm({ ...connForm, host: e.target.value })} placeholder="192.168.1.10" /></FormField>
              <FormField id="conn-rack" label="Rack"><Input id="conn-rack" type="number" min={0} value={connForm.rack} onChange={(e) => setConnForm({ ...connForm, rack: e.target.value })} /></FormField>
              <FormField id="conn-slot" label="Slot"><Input id="conn-slot" type="number" min={0} value={connForm.slot} onChange={(e) => setConnForm({ ...connForm, slot: e.target.value })} /></FormField>
              <FormField id="conn-polling" label="Polling (ms)"><Input id="conn-polling" type="number" min={100} value={connForm.pollingIntervalMs} onChange={(e) => setConnForm({ ...connForm, pollingIntervalMs: e.target.value })} /></FormField>
              <FormField id="conn-reconnect" label="Reconnect (ms)"><Input id="conn-reconnect" type="number" min={1000} value={connForm.reconnectIntervalMs} onChange={(e) => setConnForm({ ...connForm, reconnectIntervalMs: e.target.value })} /></FormField>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={createConnMut.isPending || updateConnMut.isPending}>
                {editingConn ? 'Update' : 'Create'}
              </Button>
              <Button variant="secondary" type="button" onClick={resetConnForm}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {connections.length === 0 && !showConnForm ? (
        <p className="text-sm text-gray-500">No S7 connections configured.</p>
      ) : (
        connections.map((conn) => {
          const status = statuses.find((s) => s.connectionId === conn.id);
          const connMappings = mappings.filter((m) => m.connectionId === conn.id);
          return (
            <div key={conn.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{conn.name}</p>
                    <p className="text-xs text-gray-500">{conn.host} · Rack {conn.rack} · Slot {conn.slot} · Poll {conn.pollingIntervalMs}ms</p>
                  </div>
                  <Badge variant={status?.state === 'connected' ? 'green' : status?.state === 'error' ? 'red' : 'gray'} dot>
                    {status?.state ?? 'disconnected'}
                  </Badge>
                  {status?.errorMessage && <span className="text-xs text-red-600">{status.errorMessage}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => startEditConn(conn)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConnId(conn.id)}>
                    <span className="text-red-600">Delete</span>
                  </Button>
                </div>
              </div>

              <ConfirmDialog
                open={deleteConnId === conn.id}
                title={`Delete "${conn.name}"?`}
                message="Delete this connection and all its mappings? This cannot be undone."
                variant="danger"
                onConfirm={() => deleteConnMut.mutate(conn.id)}
                onCancel={() => setDeleteConnId(null)}
              />

              <ConnectionMappings
                connection={conn}
                mappings={connMappings}
                allNodes={allNodes}
                getNodePath={getNodePath}
                currentValues={currentValues.filter((v) => v.connectionId === conn.id)}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

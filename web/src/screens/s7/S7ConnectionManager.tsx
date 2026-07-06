import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getS7Connections,
  deleteS7Connection,
  getS7Mappings,
  getS7Status,
  getS7Values,
  getNodes,
  exportS7MappingsCsv,
  importS7MappingsCsv,
  S7Connection,
  S7MappingItem,
  S7ConnectionStatus,
  S7CurrentValue,
  S7MappingImportResult,
  OpcUaNode,
} from '../../api';
import { Button, Alert, FileButton } from '../../components';
import { downloadTextAsFile } from '../../utils/downloadFile';
import { useNodePaths } from '../../hooks/useNodePaths';
import { S7ConnectionForm, ConnectionFormData, EMPTY_CONN_FORM } from './S7ConnectionForm';
import { S7ConnectionCard } from './S7ConnectionCard';

export function S7ConnectionManager() {
  const queryClient = useQueryClient();
  const [showConnForm, setShowConnForm] = useState(false);
  const [editingConn, setEditingConn] = useState<S7Connection | null>(null);
  const [connFormData, setConnFormData] = useState<ConnectionFormData>(EMPTY_CONN_FORM);
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
  const { getNodePath } = useNodePaths();

  const deleteConnMut = useMutation({
    mutationFn: deleteS7Connection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-connections'] });
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      queryClient.invalidateQueries({ queryKey: ['s7-status'] });
      setDeleteConnId(null);
    },
  });

  function resetConnForm(): void {
    setShowConnForm(false);
    setEditingConn(null);
    setConnFormData(EMPTY_CONN_FORM);
  }

  function startEditConn(c: S7Connection): void {
    setEditingConn(c);
    setConnFormData({
      name: c.name, host: c.host, rack: String(c.rack), slot: String(c.slot),
      pollingIntervalMs: String(c.pollingIntervalMs), reconnectIntervalMs: String(c.reconnectIntervalMs),
    });
    setShowConnForm(true);
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
        <S7ConnectionForm
          editingConn={editingConn}
          initialData={connFormData}
          onClose={resetConnForm}
        />
      )}

      {connections.length === 0 && !showConnForm ? (
        <p className="text-sm text-gray-500">No S7 connections configured.</p>
      ) : (
        connections.map((conn) => (
          <S7ConnectionCard
            key={conn.id}
            connection={conn}
            status={statuses.find((s) => s.connectionId === conn.id)}
            mappings={mappings.filter((m) => m.connectionId === conn.id)}
            allNodes={allNodes}
            getNodePath={getNodePath}
            currentValues={currentValues.filter((v) => v.connectionId === conn.id)}
            isDeleteOpen={deleteConnId === conn.id}
            onEdit={() => startEditConn(conn)}
            onDeleteRequest={() => setDeleteConnId(conn.id)}
            onDeleteConfirm={() => deleteConnMut.mutate(conn.id)}
            onDeleteCancel={() => setDeleteConnId(null)}
          />
        ))
      )}
    </div>
  );
}

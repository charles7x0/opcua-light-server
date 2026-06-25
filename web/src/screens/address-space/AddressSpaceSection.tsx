import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AddressSpaceTree, { SelectedNode } from './AddressSpaceTree';
import NodeDetailPanel from './NodeDetailPanel';
import { NodeForm } from './NodeForm';
import { NamespaceManager } from './NamespaceManager';
import { deleteNode, exportNodesCsv, importNodesCsv, CsvImportResult } from '../../api';
import { Button, Alert, ConfirmDialog, FileButton } from '../../components';
import { downloadTextAsFile } from '../../utils/downloadFile';

function CreateNodeSplitButton({
  onCreateVariable,
  onCreateObjectNode,
}: {
  onCreateVariable: () => void;
  onCreateObjectNode: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <div className="flex">
        <Button variant="success" onClick={onCreateVariable} className="rounded-r-none">
          Create Variable Node
        </Button>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-r-md rounded-l-none bg-green-700 px-2 py-2 text-sm font-medium text-white hover:bg-green-800 border-l border-green-500"
          aria-label="More create options"
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="absolute left-0 mt-1 w-56 rounded-md bg-white shadow-lg border border-gray-200 z-10">
          <button
            onClick={() => { onCreateVariable(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            🔹 Create Variable Node
          </button>
          <button
            onClick={() => { onCreateObjectNode(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            📦 Create Object Node (subfolder)
          </button>
        </div>
      )}
    </div>
  );
}

export function AddressSpaceSection() {
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [editingNode, setEditingNode] = useState<SelectedNode | null>(null);
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      setSelectedNode(null);
      setShowDeleteConfirm(false);
    },
  });

  function handleDeleteNode() {
    if (!selectedNode) return;
    setShowDeleteConfirm(true);
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const csv = await exportNodesCsv();
      downloadTextAsFile(csv, 'nodes.csv');
    } catch (e) {
      alert('Export failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport(file: File) {
    setIsImporting(true);
    setImportResult(null);
    setImportError('');
    try {
      const text = await file.text();
      const result = await importNodesCsv(text);
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <NamespaceManager />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tree panel */}
        <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <AddressSpaceTree
            onNodeSelect={(selection) => {
              setSelectedNode(selection);
              setShowNodeForm(false);
              setEditingNode(null);
            }}
            selectedNodeId={selectedNode?.node.id}
          />
        </div>

        {/* Detail / Form panel */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {showNodeForm || editingNode ? (
            <div className="p-4">
              <NodeForm
                node={editingNode?.node}
                onSuccess={() => {
                  setShowNodeForm(false);
                  setEditingNode(null);
                  setSelectedNode(null);
                }}
                onCancel={() => {
                  setShowNodeForm(false);
                  setEditingNode(null);
                }}
              />
            </div>
          ) : (
            <>
              <NodeDetailPanel selection={selectedNode} />
              {selectedNode && (
                <div className="px-4 pb-4 flex gap-2">
                  <Button size="sm" onClick={() => setEditingNode(selectedNode)}>
                    Edit Node
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDeleteNode}
                    loading={deleteMutation.isPending}
                  >
                    Delete Node
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create node split button */}
      {!showNodeForm && !editingNode && (
        <div className="flex items-center gap-3 flex-wrap">
          <CreateNodeSplitButton
            onCreateVariable={() => {
              setShowNodeForm(true);
              setSelectedNode(null);
            }}
            onCreateObjectNode={() => {
              alert('Use the "+" button on a namespace or object node in the tree above to create an object node (subfolder).');
            }}
          />

          <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : '📥 Export CSV'}
          </Button>

          <FileButton accept=".csv,text/csv" disabled={isImporting} onFileSelect={handleImport}>
            {isImporting ? 'Importing...' : '📤 Import CSV'}
          </FileButton>
        </div>
      )}

      {/* Import results */}
      {importResult && (
        <Alert
          variant={importResult.summary.failed > 0 ? 'warning' : 'success'}
          onDismiss={() => setImportResult(null)}
        >
          Import complete: {importResult.summary.succeeded} succeeded, {importResult.summary.failed} failed out of {importResult.summary.total} rows.
          {importResult.summary.failed > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs max-h-32 overflow-y-auto">
              {importResult.results.filter((r) => !r.success).map((r) => (
                <li key={r.row}>Row {r.row}{r.name ? ` (${r.name})` : ''}: {r.error}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {importError && (
        <Alert variant="error" onDismiss={() => setImportError('')}>
          {importError}
        </Alert>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Variable Node?"
        message={`Delete variable node "${selectedNode?.node.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (selectedNode) deleteMutation.mutate(selectedNode.node.id);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

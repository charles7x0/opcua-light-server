import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createS7Mapping,
  updateS7Mapping,
  deleteS7Mapping,
  S7Connection,
  S7MappingItem,
  S7CurrentValue,
  OpcUaNode,
} from '../../api';
import { Button, Input, ConfirmDialog, Select } from '../../components';
import { S7BulkImport } from './S7BulkImport';

interface EditableRow {
  id: string | null;
  plcAddress: string;
  description: string;
  nodeId: string;
  dirty: boolean;
}

interface S7MappingTableProps {
  connection: S7Connection;
  mappings: S7MappingItem[];
  allNodes: OpcUaNode[];
  getNodePath: (node: OpcUaNode) => string;
  currentValues: S7CurrentValue[];
}

export function S7MappingTable({ connection, mappings, allNodes, getNodePath, currentValues }: S7MappingTableProps) {
  const queryClient = useQueryClient();
  const [showBulk, setShowBulk] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
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

  function addBlankRow(): void {
    setRows([...rows, { id: null, plcAddress: '', description: '', nodeId: '', dirty: true }]);
  }

  function updateRow(index: number, field: keyof EditableRow, value: string): void {
    const updated = [...rows];
    (updated[index] as any)[field] = value;
    updated[index].dirty = true;
    setRows(updated);
    setSuccessMsg('');
  }

  function removeRow(index: number): void {
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

      {error && <div className="px-6 py-2 bg-danger-50 border-b border-danger-100"><p className="text-xs text-danger-600 whitespace-pre-line">{error}</p></div>}
      {successMsg && <div className="px-6 py-2 bg-success-50 border-b border-success-100"><p className="text-xs text-success-700">✓ {successMsg}</p></div>}

      {showBulk && (
        <S7BulkImport
          connectionId={connection.id}
          allNodes={allNodes}
          onClose={() => setShowBulk(false)}
        />
      )}

      {rows.length === 0 && !showBulk ? (
        <div className="px-6 py-4">
          <p className="text-xs text-gray-400 italic">No variable mappings. Click &quot;+ Add Row&quot; to start.</p>
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
                    <button onClick={() => removeRow(idx)} className="text-danger-400 hover:text-danger-600 text-sm" title="Remove row">×</button>
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

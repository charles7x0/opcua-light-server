import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createS7MappingsBulk, OpcUaNode, ApiError } from '../../api';
import { Button } from '../../components';

interface S7BulkImportProps {
  connectionId: string;
  allNodes: OpcUaNode[];
  onClose: () => void;
}

export function S7BulkImport({ connectionId, allNodes, onClose }: S7BulkImportProps) {
  const queryClient = useQueryClient();
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState('');

  const bulkMut = useMutation({
    mutationFn: (data: Array<{ connectionId: string; nodeId: string; plcAddress: string }>) => createS7MappingsBulk(data),
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['s7-mappings'] });
      const failed = results.filter((r) => !r.success);
      if (failed.length === 0) {
        onClose();
      } else {
        setBulkError(`${failed.length} failed: ${failed.map((f) => f.error).join('; ')}`);
      }
    },
    onError: (e: Error) => setBulkError(e instanceof ApiError ? e.message : 'Failed'),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!bulkText.trim()) { setBulkError('Enter mappings'); return; }
    const lines = bulkText.trim().split('\n').filter((l) => l.trim());
    const data: Array<{ connectionId: string; nodeId: string; plcAddress: string }> = [];
    for (const line of lines) {
      const [addr, ref] = line.split(',').map((s) => s.trim());
      if (!addr || !ref) { setBulkError(`Invalid: "${line}"`); return; }
      const node = allNodes.find((n) => n.name === ref) || allNodes.find((n) => n.id === ref);
      if (!node) { setBulkError(`Node not found: "${ref}"`); return; }
      data.push({ connectionId, nodeId: node.id, plcAddress: addr });
    }
    setBulkError('');
    bulkMut.mutate(data);
  }

  return (
    <div className="px-6 py-4 border-b border-gray-100 bg-primary-50/40">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs font-medium text-gray-700">Bulk Import</p>
        <p className="text-[11px] text-gray-500">
          One per line: <code className="bg-gray-100 px-1 rounded">PLCAddress,NodeName</code>
        </p>
        {bulkError && <p className="text-xs text-danger-600">{bulkError}</p>}
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={4}
          placeholder={"DB1,REAL0,Temperature\nDB1,REAL4,Pressure"}
          className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs font-mono focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
        />
        <div className="flex gap-2">
          <Button size="sm" type="submit" loading={bulkMut.isPending}>Import All</Button>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

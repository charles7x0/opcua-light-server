import { useState } from 'react';
import { ConnectorMapping, ConnectorCurrentValue } from '../../api';
import { Button, Input, Select, ConfirmDialog } from '../../components';

interface MappingTableProps {
  connectionId: string;
  connectionType: string;
  mappings: ConnectorMapping[];
  currentValues: ConnectorCurrentValue[];
  allNodes: Array<{ id: string; name: string }>;
  onAddMapping: (data: { connectionId: string; nodeId?: string; deviceAddress: string }) => Promise<void>;
  onUpdateMapping: (id: string, data: { nodeId?: string; deviceAddress?: string }) => Promise<void>;
  onRemoveMapping: (mappingId: string) => void;
}

const ADDRESS_PLACEHOLDERS: Record<string, string> = {
  's7': 'DB1,REAL0',
  'modbus-tcp': 'HR:100:1',
  'ethernet-ip': 'Program:Main.Tag',
};

function getAddressPlaceholder(connectionType: string): string {
  return ADDRESS_PLACEHOLDERS[connectionType] ?? 'Device address';
}

export function MappingTable({
  connectionId,
  connectionType,
  mappings,
  currentValues,
  allNodes,
  onAddMapping,
  onUpdateMapping,
  onRemoveMapping,
}: MappingTableProps): JSX.Element {
  const [newNodeId, setNewNodeId] = useState('');
  const [newDeviceAddress, setNewDeviceAddress] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNodeId, setEditNodeId] = useState('');
  const [editDeviceAddress, setEditDeviceAddress] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  async function handleAdd(): Promise<void> {
    if (!newDeviceAddress.trim()) return;
    setIsAdding(true);
    setAddError('');
    try {
      await onAddMapping({
        connectionId,
        nodeId: newNodeId || undefined,
        deviceAddress: newDeviceAddress.trim(),
      });
      setNewNodeId('');
      setNewDeviceAddress('');
    } catch (e: unknown) {
      setAddError((e as Error).message ?? 'Failed to add mapping');
    } finally {
      setIsAdding(false);
    }
  }

  function startEdit(mapping: ConnectorMapping): void {
    setEditingId(mapping.id);
    setEditNodeId(mapping.nodeId ?? '');
    setEditDeviceAddress(mapping.deviceAddress);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditNodeId('');
    setEditDeviceAddress('');
  }

  async function handleUpdate(): Promise<void> {
    if (!editingId || !editDeviceAddress.trim()) return;
    setIsUpdating(true);
    try {
      await onUpdateMapping(editingId, {
        nodeId: editNodeId || undefined,
        deviceAddress: editDeviceAddress.trim(),
      });
      setEditingId(null);
      setEditNodeId('');
      setEditDeviceAddress('');
    } catch (e: unknown) {
      setAddError((e as Error).message ?? 'Failed to update mapping');
    } finally {
      setIsUpdating(false);
    }
  }

  function handleRemoveRequest(mappingId: string): void {
    setDeleteConfirmId(mappingId);
  }

  function handleRemoveConfirm(): void {
    if (deleteConfirmId) {
      onRemoveMapping(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }

  function getValueForMapping(mapping: ConnectorMapping): ConnectorCurrentValue | undefined {
    return currentValues.find(
      (v) => v.connectionId === mapping.connectionId && v.deviceAddress === mapping.deviceAddress,
    );
  }

  function getNodeName(nodeId: string | null): string {
    if (!nodeId) return '—';
    const node = allNodes.find((n) => n.id === nodeId);
    return node?.name ?? nodeId;
  }

  return (
    <div className="border-t border-gray-200">
      <div className="px-6 py-3 flex items-center justify-between bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Mappings ({mappings.length})
        </span>
      </div>

      {addError && (
        <div className="px-6 py-2 bg-danger-50 border-b border-danger-100">
          <p role="alert" className="text-xs text-danger-600">{addError}</p>
        </div>
      )}

      <table className="w-full text-xs" aria-label="Variable mappings">
        <thead>
          <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide border-b border-gray-200 bg-gray-50/50">
            <th scope="col" className="pl-6 pr-2 py-2 font-medium w-[180px]">Device Address</th>
            <th scope="col" className="px-2 py-2 font-medium">Mapped Node</th>
            <th scope="col" className="px-2 py-2 font-medium w-[130px]">Value</th>
            <th scope="col" className="px-2 py-2 font-medium w-[80px]">Quality</th>
            <th scope="col" className="px-2 pr-6 py-2 font-medium w-[80px]"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {mappings.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-4">
                <p className="text-xs text-gray-400 italic">No mappings configured. Use the row below to add one.</p>
              </td>
            </tr>
          )}
          {mappings.map((mapping) => {
            const liveValue = getValueForMapping(mapping);
            const isEditing = editingId === mapping.id;

            if (isEditing) {
              return (
                <tr key={mapping.id} className="bg-yellow-50/50">
                  <td className="pl-6 pr-2 py-1">
                    <Input
                      type="text"
                      inputSize="xs"
                      value={editDeviceAddress}
                      onChange={(e) => setEditDeviceAddress(e.target.value)}
                      placeholder={getAddressPlaceholder(connectionType)}
                      className="mt-0 font-mono bg-white"
                      aria-label="Edit device address"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      selectSize="xs"
                      value={editNodeId}
                      onChange={(e) => setEditNodeId(e.target.value)}
                      className="mt-0 bg-white"
                      aria-label="Edit mapped node"
                    >
                      <option value="">Select node...</option>
                      {allNodes.map((node) => (
                        <option key={node.id} value={node.id}>{node.name}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1"></td>
                  <td className="px-2 py-1"></td>
                  <td className="px-2 pr-6 py-1 text-center">
                    <div className="flex items-center gap-1 justify-center">
                      <Button
                        type="button"
                        variant="success"
                        size="xs"
                        onClick={() => { void handleUpdate(); }}
                        disabled={!editDeviceAddress.trim() || isUpdating}
                        loading={isUpdating}
                        aria-label="Save mapping"
                      >
                        ✓
                      </Button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-gray-400 hover:text-gray-600 text-sm px-1"
                        aria-label="Cancel edit"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={mapping.id} className="group">
                <td className="pl-6 pr-2 py-2 font-mono text-gray-900">
                  {mapping.deviceAddress}
                </td>
                <td className="px-2 py-2 text-gray-700">
                  {mapping.nodeId
                    ? getNodeName(mapping.nodeId)
                    : <span className="text-gray-400 italic">unmapped</span>}
                </td>
                <td className="px-2 py-2 font-mono text-gray-900">
                  {liveValue?.value !== undefined && liveValue?.value !== null
                    ? String(liveValue.value)
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-2 py-2">
                  {liveValue ? (
                    <span className="inline-flex items-center gap-1.5 text-xs" role="status" aria-label={`Quality: ${liveValue.quality}`}>
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${
                          liveValue.quality === 'good' ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                      <span className={liveValue.quality === 'good' ? 'text-green-700' : 'text-red-700'}>
                        {liveValue.quality}
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-2 pr-6 py-2 text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <button
                      type="button"
                      onClick={() => startEdit(mapping)}
                      className="text-gray-400 hover:text-primary-600 focus:text-primary-600 text-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      title="Edit mapping"
                      aria-label={`Edit mapping ${mapping.deviceAddress}`}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveRequest(mapping.id)}
                      className="text-danger-400 hover:text-danger-600 text-sm"
                      title="Remove mapping"
                      aria-label={`Remove mapping ${mapping.deviceAddress}`}
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {/* Add mapping form row */}
          <tr className="border-t border-gray-100 bg-gray-50/30">
            <td className="pl-6 pr-2 py-2">
              <Input
                type="text"
                inputSize="xs"
                value={newDeviceAddress}
                onChange={(e) => setNewDeviceAddress(e.target.value)}
                placeholder={getAddressPlaceholder(connectionType)}
                className="mt-0 font-mono bg-white"
                aria-label="New mapping device address"
              />
            </td>
            <td className="px-2 py-2">
              <Select
                selectSize="xs"
                value={newNodeId}
                onChange={(e) => setNewNodeId(e.target.value)}
                className="mt-0 bg-white"
                aria-label="Select OPC UA node for new mapping"
              >
                <option value="">Select node...</option>
                {allNodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.name}</option>
                ))}
              </Select>
            </td>
            <td className="px-2 py-2"></td>
            <td className="px-2 py-2"></td>
            <td className="px-2 pr-6 py-2 text-center">
              <Button
                type="button"
                size="xs"
                onClick={() => { void handleAdd(); }}
                disabled={!newDeviceAddress.trim() || isAdding}
                loading={isAdding}
                aria-label="Add mapping"
              >
                +
              </Button>
            </td>
          </tr>
        </tbody>
      </table>

      {deleteConfirmId && (
        <ConfirmDialog
          open={!!deleteConfirmId}
          title="Delete Mapping?"
          message={`Delete mapping "${mappings.find((m) => m.id === deleteConfirmId)?.deviceAddress}"?`}
          variant="danger"
          onConfirm={handleRemoveConfirm}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}

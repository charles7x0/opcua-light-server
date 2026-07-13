import { useState } from 'react';
import { ConnectorMapping, ConnectorCurrentValue } from '../../api';
import { Button, Input, Select, ConfirmDialog } from '../../components';

interface MappingTableProps {
  connectionId: string;
  connectionType: string;
  mappings: ConnectorMapping[];
  currentValues: ConnectorCurrentValue[];
  allNodes: Array<{ id: string; name: string }>;
  onAddMapping: (data: { connectionId: string; nodeId: string; deviceAddress: string }) => void;
  onRemoveMapping: (mappingId: string) => void;
}

const ADDRESS_PLACEHOLDERS: Record<string, string> = {
  's7': 'DB1,REAL0',
  'modbus-tcp': 'HR:100:1',
  'ethernet-ip': 'TagName',
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
  onRemoveMapping,
}: MappingTableProps): JSX.Element {
  const [newNodeId, setNewNodeId] = useState('');
  const [newDeviceAddress, setNewDeviceAddress] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function handleAdd(): void {
    if (!newNodeId || !newDeviceAddress.trim()) return;
    onAddMapping({ connectionId, nodeId: newNodeId, deviceAddress: newDeviceAddress.trim() });
    setNewNodeId('');
    setNewDeviceAddress('');
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

  function getNodeName(nodeId: string): string {
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

      {mappings.length === 0 && (
        <div className="px-6 py-4">
          <p className="text-xs text-gray-400 italic">No mappings configured. Use the form below to add one.</p>
        </div>
      )}

      {mappings.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide border-b border-gray-200 bg-gray-50/50">
              <th className="pl-6 pr-2 py-2 font-medium w-[180px]">Device Address</th>
              <th className="px-2 py-2 font-medium">Mapped Node</th>
              <th className="px-2 py-2 font-medium w-[130px]">Value</th>
              <th className="px-2 py-2 font-medium w-[80px]">Quality</th>
              <th className="px-2 pr-6 py-2 font-medium w-[40px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mappings.map((mapping) => {
              const liveValue = getValueForMapping(mapping);
              return (
                <tr key={mapping.id}>
                  <td className="pl-6 pr-2 py-2 font-mono text-gray-900">
                    {mapping.deviceAddress}
                  </td>
                  <td className="px-2 py-2 text-gray-700">
                    {getNodeName(mapping.nodeId)}
                  </td>
                  <td className="px-2 py-2 font-mono text-gray-900">
                    {liveValue?.value !== undefined && liveValue?.value !== null
                      ? String(liveValue.value)
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-2">
                    {liveValue ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
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
                    <button
                      type="button"
                      onClick={() => handleRemoveRequest(mapping.id)}
                      className="text-danger-400 hover:text-danger-600 text-sm"
                      title="Remove mapping"
                      aria-label={`Remove mapping ${mapping.deviceAddress}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Add mapping form row */}
      <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/30 flex items-center gap-2">
        <Input
          type="text"
          inputSize="xs"
          value={newDeviceAddress}
          onChange={(e) => setNewDeviceAddress(e.target.value)}
          placeholder={getAddressPlaceholder(connectionType)}
          className="mt-0 font-mono bg-white w-[180px]"
          aria-label="Device address"
        />
        <Select
          selectSize="xs"
          value={newNodeId}
          onChange={(e) => setNewNodeId(e.target.value)}
          className="mt-0 bg-white flex-1"
          aria-label="Select OPC UA node"
        >
          <option value="">Select node...</option>
          {allNodes.map((node) => (
            <option key={node.id} value={node.id}>{node.name}</option>
          ))}
        </Select>
        <Button
          size="xs"
          onClick={handleAdd}
          disabled={!newNodeId || !newDeviceAddress.trim()}
          aria-label="Add mapping"
        >
          + Add
        </Button>
      </div>

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

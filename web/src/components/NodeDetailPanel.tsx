import { SelectedNode } from './AddressSpaceTree';

interface NodeDetailPanelProps {
  selection: SelectedNode | null;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm text-gray-900">{value || '—'}</dd>
    </div>
  );
}

export default function NodeDetailPanel({ selection }: NodeDetailPanelProps) {
  if (!selection) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-sm text-gray-400">
        Select a node from the tree to view its details.
      </div>
    );
  }

  const { node, namespaceName, objectNodePath } = selection;
  const displayPath = objectNodePath
    ? `${namespaceName} / ${objectNodePath.replace(/\//g, ' / ')}`
    : namespaceName;

  const formattedValue =
    node.initialValue !== undefined && node.initialValue !== null
      ? typeof node.initialValue === 'object'
        ? JSON.stringify(node.initialValue, null, 2)
        : String(node.initialValue)
      : '—';

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-gray-200 pb-3">
        <h2 className="text-lg font-semibold text-gray-900">{node.name}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{displayPath}</p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailRow label="Data Type" value={
          <span className="inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {node.dataType}
          </span>
        } />
        <DetailRow label="Current Value" value={
          <code className="text-sm font-mono bg-gray-50 px-1.5 py-0.5 rounded">
            {formattedValue}
          </code>
        } />
        <DetailRow label="Namespace" value={namespaceName} />
        <DetailRow label="Parent Path" value={objectNodePath || '(root)'} />
        <DetailRow label="Description" value={node.description} />
        <DetailRow label="Node ID" value={
          <code className="text-xs font-mono text-gray-600 break-all">{node.id}</code>
        } />
      </dl>

      <div className="border-t border-gray-200 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Metadata
        </h3>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-700">
              {new Date(node.createdAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Updated</dt>
            <dd className="text-gray-700">
              {new Date(node.updatedAt).toLocaleString()}
            </dd>
          </div>
          {node.objectNodeId && (
            <div>
              <dt className="text-gray-500">Object Node ID</dt>
              <dd className="text-gray-700 font-mono">{node.objectNodeId}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Namespace ID</dt>
            <dd className="text-gray-700 font-mono">{node.namespaceId}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

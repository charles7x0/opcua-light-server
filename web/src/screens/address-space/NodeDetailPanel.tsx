import { SelectedNode } from './AddressSpaceTree';
import { Card, Badge, CopyButton } from '../../components';

interface NodeDetailPanelProps {
  selection: SelectedNode | null;
}

/**
 * Build the OPC UA NodeId the same way the runtime does:
 *   ns=<namespaceIndex>;s=<namespaceName>[.<objectPath with '.' separators>].<nodeName>
 * The object node path uses '/' separators in the UI; the runtime uses '.'.
 *
 * The namespace index is computed by AddressSpaceTree to mirror the runtime's
 * registration order (see ConfigGenerator.buildNamespaces): namespaces are sorted
 * by name and assigned indices starting at 2 (ns=0 is the OPC UA base namespace,
 * ns=1 is the server's own namespace).
 */
function buildOpcUaNodeId(
  namespaceIndex: number,
  namespaceName: string,
  objectNodePath: string,
  nodeName: string
): string {
  const parentPath = objectNodePath
    ? `${namespaceName}.${objectNodePath.replace(/\//g, '.')}`
    : namespaceName;
  return `ns=${namespaceIndex};s=${parentPath}.${nodeName}`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  const isEmpty = !value;
  return (
    <div className="flex flex-col gap-0.5" role="group">
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm text-gray-900">
        {isEmpty ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not set</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export default function NodeDetailPanel({ selection }: NodeDetailPanelProps) {
  if (!selection) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-sm text-gray-400" role="status">
        Select a node from the tree to view its details.
      </div>
    );
  }

  const { node, namespaceName, namespaceIndex, objectNodePath } = selection;
  const displayPath = objectNodePath
    ? `${namespaceName} / ${objectNodePath.replace(/\//g, ' / ')}`
    : namespaceName;
  const opcUaNodeId = buildOpcUaNodeId(namespaceIndex, namespaceName, objectNodePath, node.name);

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
          <Badge variant="blue" role={undefined}>{node.dataType}</Badge>
        } />
        <DetailRow label="Current Value" value={
          <code className="text-sm font-mono bg-gray-50 px-1.5 py-0.5 rounded">
            {formattedValue}
          </code>
        } />
        <DetailRow label="Node ID" value={
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <code className="text-sm font-mono bg-gray-50 px-1.5 py-0.5 rounded break-all">
                {opcUaNodeId}
              </code>
              <CopyButton value={opcUaNodeId} label={`Copy node ID ${opcUaNodeId}`} />
            </span>
            <span className="text-xs text-gray-500">
              The namespace index (ns) reflects the runtime registration order and
              may change if namespaces are added or removed.
            </span>
          </span>
        } />
        <DetailRow label="Namespace" value={namespaceName} />
        <DetailRow label="Parent Path" value={objectNodePath || '(root)'} />
        <DetailRow label="Description" value={node.description} />
      </dl>

      <Card className="!border-t !border-x-0 !border-b-0 !rounded-none" padding={false}>
        <div className="pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Metadata
          </h3>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
            <div role="group">
              <dt className="text-gray-500">Created</dt>
              <dd className="text-gray-700">
                <time dateTime={new Date(node.createdAt).toISOString()}>
                  {new Date(node.createdAt).toLocaleString()}
                </time>
              </dd>
            </div>
            <div role="group">
              <dt className="text-gray-500">Updated</dt>
              <dd className="text-gray-700">
                <time dateTime={new Date(node.updatedAt).toISOString()}>
                  {new Date(node.updatedAt).toLocaleString()}
                </time>
              </dd>
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

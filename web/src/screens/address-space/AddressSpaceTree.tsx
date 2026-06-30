import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getNamespaces, getObjectNodeTree, getNodes, createObjectNode, deleteObjectNode, Namespace, ObjectNode, OpcUaNode, ApiError } from '../../api';

export interface SelectedNode {
  node: OpcUaNode;
  namespaceName: string;
  objectNodePath: string;
}

interface AddressSpaceTreeProps {
  onNodeSelect: (selection: SelectedNode | null) => void;
  selectedNodeId?: string;
}

interface TreeItemProps {
  label: string;
  icon: string;
  level: number;
  expanded?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

function TreeItem({ label, icon, level, expanded, selected, onToggle, onClick, actions, children }: TreeItemProps) {
  const hasChildren = !!children;
  const paddingLeft = `${level * 1.25}rem`;
  const [hovered, setHovered] = useState(false);

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded text-sm hover:bg-gray-100 ${
          selected ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
        }`}
        style={{ paddingLeft }}
        onClick={() => {
          if (hasChildren && onToggle) onToggle();
          if (onClick) onClick();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selected}
      >
        {hasChildren && (
          <span className="text-gray-400 w-4 text-center text-xs">
            {expanded ? '▼' : '▶'}
          </span>
        )}
        {!hasChildren && <span className="w-4" />}
        <span>{icon}</span>
        <span className="truncate flex-1">{label}</span>
        {hovered && actions && (
          <span className="flex items-center gap-0.5 ml-auto" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {expanded && children}
    </div>
  );
}

/** Inline form for creating a new object node. */
function InlineCreateForm({
  level,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  level: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string;
}) {
  const [name, setName] = useState('');
  const paddingLeft = `${level * 1.25}rem`;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft }}>
      <span className="w-4" />
      <span>📦</span>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Object name..."
        autoFocus
        disabled={isSubmitting}
        className="flex-1 text-sm border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-500 min-w-0"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button
        type="submit"
        disabled={isSubmitting || !name.trim()}
        className="text-xs text-green-600 hover:text-green-800 font-medium disabled:opacity-50"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        ✕
      </button>
      {error && <span className="text-xs text-red-500 ml-1">{error}</span>}
    </form>
  );
}

function ObjectNodeTreeItem({
  objectNode,
  level,
  nodes,
  namespaceName,
  namespaceId,
  objectNodePath,
  selectedNodeId,
  onNodeSelect,
  depth,
}: {
  objectNode: ObjectNode;
  level: number;
  nodes: OpcUaNode[];
  namespaceName: string;
  namespaceId: string;
  objectNodePath: string;
  selectedNodeId?: string;
  onNodeSelect: (selection: SelectedNode | null) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const queryClient = useQueryClient();

  const childNodes = nodes.filter((n) => n.objectNodeId === objectNode.id);
  const currentPath = objectNodePath ? `${objectNodePath}/${objectNode.name}` : objectNode.name;

  const createMutation = useMutation({
    mutationFn: (name: string) => createObjectNode({ name, namespaceId, parentObjectNodeId: objectNode.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-nodes', namespaceId] });
      setCreating(false);
      setCreateError('');
      setExpanded(true);
    },
    onError: (err: Error) => {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteObjectNode(objectNode.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-nodes', namespaceId] });
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const canAddChild = depth < 5;

  return (
    <TreeItem
      label={objectNode.name}
      icon="📦"
      level={level}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      actions={
        <>
          {canAddChild && (
            <button
              onClick={() => { setCreating(true); setExpanded(true); }}
              className="text-xs text-primary-500 hover:text-primary-700 px-0.5"
              title="Add child object node"
            >
              +
            </button>
          )}
          <button
            onClick={() => { if (confirm(`Delete "${objectNode.name}"?`)) deleteMutation.mutate(); }}
            className="text-xs text-danger-400 hover:text-danger-600 px-0.5"
            title="Delete object node"
          >
            ×
          </button>
        </>
      }
    >
      {objectNode.children?.map((child) => (
        <ObjectNodeTreeItem
          key={child.id}
          objectNode={child}
          level={level + 1}
          nodes={nodes}
          namespaceName={namespaceName}
          namespaceId={namespaceId}
          objectNodePath={currentPath}
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
          depth={depth + 1}
        />
      ))}
      {creating && (
        <InlineCreateForm
          level={level + 1}
          onSubmit={(name) => createMutation.mutate(name)}
          onCancel={() => { setCreating(false); setCreateError(''); }}
          isSubmitting={createMutation.isPending}
          error={createError}
        />
      )}
      {childNodes.map((node) => (
        <TreeItem
          key={node.id}
          label={node.name}
          icon="🔹"
          level={level + 1}
          selected={node.id === selectedNodeId}
          onClick={() =>
            onNodeSelect({ node, namespaceName, objectNodePath: currentPath })
          }
        />
      ))}
    </TreeItem>
  );
}

function NamespaceTreeNode({
  namespace,
  selectedNodeId,
  onNodeSelect,
}: {
  namespace: Namespace;
  selectedNodeId?: string;
  onNodeSelect: (selection: SelectedNode | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const queryClient = useQueryClient();

  const { data: objectNodes = [] } = useQuery({
    queryKey: ['object-nodes', namespace.id],
    queryFn: () => getObjectNodeTree(namespace.id),
    enabled: expanded,
  });

  const { data: allNodes = [] } = useQuery({
    queryKey: ['nodes'],
    queryFn: getNodes,
    enabled: expanded,
  });

  const namespaceNodes = allNodes.filter((n) => n.namespaceId === namespace.id);
  const rootNodes = namespaceNodes.filter((n) => n.objectNodeId === null);

  const createMutation = useMutation({
    mutationFn: (name: string) => createObjectNode({ name, namespaceId: namespace.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-nodes', namespace.id] });
      setCreating(false);
      setCreateError('');
    },
    onError: (err: Error) => {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create');
    },
  });

  return (
    <TreeItem
      label={namespace.name}
      icon="🌐"
      level={0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      actions={
        <button
          onClick={() => { setCreating(true); setExpanded(true); }}
          className="text-xs text-primary-500 hover:text-primary-700 px-0.5"
          title="Add object node"
        >
          +
        </button>
      }
    >
      {objectNodes.map((objNode) => (
        <ObjectNodeTreeItem
          key={objNode.id}
          objectNode={objNode}
          level={1}
          nodes={namespaceNodes}
          namespaceName={namespace.name}
          namespaceId={namespace.id}
          objectNodePath=""
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
          depth={1}
        />
      ))}
      {creating && (
        <InlineCreateForm
          level={1}
          onSubmit={(name) => createMutation.mutate(name)}
          onCancel={() => { setCreating(false); setCreateError(''); }}
          isSubmitting={createMutation.isPending}
          error={createError}
        />
      )}
      {rootNodes.map((node) => (
        <TreeItem
          key={node.id}
          label={node.name}
          icon="🔹"
          level={1}
          selected={node.id === selectedNodeId}
          onClick={() =>
            onNodeSelect({ node, namespaceName: namespace.name, objectNodePath: '' })
          }
        />
      ))}
    </TreeItem>
  );
}

export default function AddressSpaceTree({ onNodeSelect, selectedNodeId }: AddressSpaceTreeProps) {
  const { data: namespaces = [], isLoading, error } = useQuery({
    queryKey: ['namespaces'],
    queryFn: getNamespaces,
  });

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-gray-500">Loading address space…</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-danger-600">
        Failed to load address space: {(error as Error).message}
      </div>
    );
  }

  if (namespaces.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No namespaces defined. Create a namespace to get started.
      </div>
    );
  }

  return (
    <div className="py-2" role="tree" aria-label="Address Space">
      <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Address Space
      </h2>
      {namespaces.map((ns) => (
        <NamespaceTreeNode
          key={ns.id}
          namespace={ns}
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
        />
      ))}
    </div>
  );
}

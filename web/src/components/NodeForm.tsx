import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createNode,
  updateNode,
  getNamespaces,
  getObjectNodeTree,
  ApiError,
  type OpcUaNode,
  type Namespace,
  type ObjectNode,
} from '../api';

/** All supported OPC UA data types. */
const DATA_TYPES = [
  'Boolean',
  'Int16',
  'Int32',
  'Int64',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float',
  'Double',
  'String',
  'DateTime',
  'ByteString',
] as const;

interface NodeFormProps {
  /** If provided, the form operates in edit mode for this node. */
  node?: OpcUaNode;
  /** Called after a successful create or update. */
  onSuccess?: () => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
}

interface FieldErrors {
  [field: string]: string;
}

/**
 * Flattens an object node tree into a list of { id, path } entries for a dropdown.
 */
function flattenObjectNodes(objectNodes: ObjectNode[], prefix = ''): Array<{ id: string; path: string }> {
  const result: Array<{ id: string; path: string }> = [];
  for (const objNode of objectNodes) {
    const path = prefix ? `${prefix}/${objNode.name}` : objNode.name;
    result.push({ id: objNode.id, path });
    if (objNode.children && objNode.children.length > 0) {
      result.push(...flattenObjectNodes(objNode.children, path));
    }
  }
  return result;
}

export function NodeForm({ node, onSuccess, onCancel }: NodeFormProps) {
  const isEdit = !!node;
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState(node?.name ?? '');
  const [dataType, setDataType] = useState(node?.dataType ?? 'Double');
  const [namespaceId, setNamespaceId] = useState(node?.namespaceId ?? '');
  const [objectNodeId, setObjectNodeId] = useState(node?.objectNodeId ?? '');
  const [initialValue, setInitialValue] = useState(
    node?.initialValue !== undefined ? String(node.initialValue) : ''
  );
  const [description, setDescription] = useState(node?.description ?? '');

  // Validation state
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState('');

  // Fetch namespaces for dropdown
  const { data: namespaces = [] } = useQuery<Namespace[]>({
    queryKey: ['namespaces'],
    queryFn: getNamespaces,
  });

  // Fetch object nodes for the selected namespace
  const { data: objectNodeTree = [] } = useQuery<ObjectNode[]>({
    queryKey: ['object-nodes', namespaceId],
    queryFn: () => getObjectNodeTree(namespaceId),
    enabled: !!namespaceId,
  });

  const flatObjectNodes = flattenObjectNodes(objectNodeTree);

  // Auto-select first namespace if none selected
  useEffect(() => {
    if (!namespaceId && namespaces.length > 0 && !isEdit) {
      setNamespaceId(namespaces[0].id);
    }
  }, [namespaces, namespaceId, isEdit]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createNode>[0]) => createNode(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      onSuccess?.();
    },
    onError: (error: Error) => handleApiError(error),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateNode>[1]) => updateNode(node!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      onSuccess?.();
    },
    onError: (error: Error) => handleApiError(error),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  function handleApiError(error: Error) {
    if (error instanceof ApiError && error.details) {
      const errors: FieldErrors = {};
      for (const detail of error.details) {
        errors[detail.field] = detail.message;
      }
      setFieldErrors(errors);
    } else if (error instanceof ApiError) {
      setGeneralError(error.message);
    } else {
      setGeneralError('An unexpected error occurred');
    }
  }

  function validateForm(): boolean {
    const errors: FieldErrors = {};

    if (!name.trim()) {
      errors.name = 'Name is required';
    }

    if (!dataType) {
      errors.dataType = 'Data type is required';
    }

    if (!namespaceId) {
      errors.namespaceId = 'Namespace is required';
    }

    setFieldErrors(errors);
    setGeneralError('');
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!validateForm()) return;

    // Parse initial value based on data type
    let parsedInitialValue: unknown = undefined;
    if (initialValue.trim()) {
      parsedInitialValue = initialValue.trim();
    }

    if (isEdit) {
      updateMutation.mutate({
        name: name.trim(),
        dataType,
        objectNodeId: objectNodeId || null,
        initialValue: parsedInitialValue,
        description: description.trim() || undefined,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        namespaceId,
        objectNodeId: objectNodeId || undefined,
        dataType,
        initialValue: parsedInitialValue,
        description: description.trim() || undefined,
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">
        {isEdit ? 'Edit Node' : 'Create Node'}
      </h2>

      {generalError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {generalError}
        </div>
      )}

      {/* Name field */}
      <div>
        <label htmlFor="node-name" className="block text-sm font-medium text-gray-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="node-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            fieldErrors.name
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
          }`}
          placeholder="e.g., Temperature.Sensor1"
        />
        {fieldErrors.name && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>
        )}
      </div>

      {/* Data Type field */}
      <div>
        <label htmlFor="node-dataType" className="block text-sm font-medium text-gray-700">
          Data Type <span className="text-red-500">*</span>
        </label>
        <select
          id="node-dataType"
          value={dataType}
          onChange={(e) => setDataType(e.target.value)}
          className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            fieldErrors.dataType
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
          }`}
        >
          {DATA_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {fieldErrors.dataType && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.dataType}</p>
        )}
      </div>

      {/* Namespace field */}
      <div>
        <label htmlFor="node-namespace" className="block text-sm font-medium text-gray-700">
          Namespace <span className="text-red-500">*</span>
        </label>
        <select
          id="node-namespace"
          value={namespaceId}
          onChange={(e) => {
            setNamespaceId(e.target.value);
            setObjectNodeId('');
          }}
          disabled={isEdit}
          className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
            fieldErrors.namespaceId
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
          } ${isEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        >
          <option value="">Select a namespace</option>
          {namespaces.map((ns) => (
            <option key={ns.id} value={ns.id}>
              {ns.name}
            </option>
          ))}
        </select>
        {fieldErrors.namespaceId && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.namespaceId}</p>
        )}
      </div>

      {/* Object Node field (optional) */}
      <div>
        <label htmlFor="node-object-node" className="block text-sm font-medium text-gray-700">
          Parent Object
        </label>
        <select
          id="node-object-node"
          value={objectNodeId}
          onChange={(e) => setObjectNodeId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">(Root)</option>
          {flatObjectNodes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.path}
            </option>
          ))}
        </select>
        {fieldErrors.objectNodeId && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.objectNodeId}</p>
        )}
      </div>

      {/* Initial Value field */}
      <div>
        <label htmlFor="node-initialValue" className="block text-sm font-medium text-gray-700">
          Initial Value
        </label>
        <input
          id="node-initialValue"
          type="text"
          value={initialValue}
          onChange={(e) => setInitialValue(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="e.g., 0, true, hello"
        />
        {fieldErrors.initialValue && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.initialValue}</p>
        )}
      </div>

      {/* Description field */}
      <div>
        <label htmlFor="node-description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="node-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Optional description for this node"
        />
        {fieldErrors.description && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.description}</p>
        )}
      </div>

      {/* S7 PLC link */}
      {!isEdit && (
        <p className="text-xs text-gray-500">
          💡 Want to map this variable to a PLC address?{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate', { detail: 's7' })); }} className="text-blue-600 hover:text-blue-800 underline">
            Connect to S7 PLC variable
          </a>
          {' '}after creating the node.
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : isEdit ? 'Update Node' : 'Create Node'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

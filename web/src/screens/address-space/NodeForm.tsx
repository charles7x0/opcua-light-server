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
} from '../../api';
import { Button, Input, Select, Textarea, FormField, Alert } from '../../components';

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
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={isSubmitting}>
      <h2 className="text-lg font-semibold text-gray-900">
        {isEdit ? 'Edit Node' : 'Create Node'}
      </h2>

      {generalError && <Alert variant="error">{generalError}</Alert>}

      <FormField id="node-name" label="Name" required error={fieldErrors.name}>
        <Input
          id="node-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={!!fieldErrors.name}
          placeholder="e.g., Temperature.Sensor1"
          aria-required="true"
          aria-describedby={fieldErrors.name ? 'node-name-error' : undefined}
        />
      </FormField>

      <FormField id="node-dataType" label="Data Type" required error={fieldErrors.dataType}>
        <Select
          id="node-dataType"
          value={dataType}
          onChange={(e) => setDataType(e.target.value)}
          error={!!fieldErrors.dataType}
          aria-required="true"
          aria-describedby={fieldErrors.dataType ? 'node-dataType-error' : undefined}
        >
          {DATA_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField id="node-namespace" label="Namespace" required error={fieldErrors.namespaceId}>
        <Select
          id="node-namespace"
          value={namespaceId}
          onChange={(e) => {
            setNamespaceId(e.target.value);
            setObjectNodeId('');
          }}
          disabled={isEdit}
          error={!!fieldErrors.namespaceId}
          aria-required="true"
          aria-describedby={fieldErrors.namespaceId ? 'node-namespace-error' : undefined}
        >
          <option value="">Select a namespace</option>
          {namespaces.map((ns) => (
            <option key={ns.id} value={ns.id}>
              {ns.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField id="node-object-node" label="Parent Object" error={fieldErrors.objectNodeId}>
        <Select
          id="node-object-node"
          value={objectNodeId}
          onChange={(e) => setObjectNodeId(e.target.value)}
          aria-describedby={fieldErrors.objectNodeId ? 'node-object-node-error' : undefined}
        >
          <option value="">(Root)</option>
          {flatObjectNodes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.path}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField id="node-initialValue" label="Initial Value" error={fieldErrors.initialValue}>
        <Input
          id="node-initialValue"
          value={initialValue}
          onChange={(e) => setInitialValue(e.target.value)}
          placeholder="e.g., 0, true, hello"
          aria-describedby={fieldErrors.initialValue ? 'node-initialValue-error' : undefined}
        />
      </FormField>

      <FormField id="node-description" label="Description" error={fieldErrors.description}>
        <Textarea
          id="node-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Optional description for this node"
          aria-describedby={fieldErrors.description ? 'node-description-error' : undefined}
        />
      </FormField>

      {/* S7 PLC link */}
      {!isEdit && (
        <p className="text-xs text-gray-500">
          <span aria-hidden="true">💡</span> Want to map this variable to a PLC address?{' '}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'connectors' }))}
            className="!inline !p-0 text-primary-600 hover:text-primary-800 underline"
          >
            Connect to a device variable
          </Button>
          {' '}after creating the node.
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Update Node' : 'Create Node'}
        </Button>
        {onCancel && (
          <Button variant="secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

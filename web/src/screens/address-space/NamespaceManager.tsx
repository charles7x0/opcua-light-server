import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNamespaces,
  createNamespace,
  updateNamespace,
  deleteNamespace,
  ApiError,
  type Namespace,
} from '../../api';
import { Button, Input, FormField, Alert, ConfirmDialog } from '../../components';

interface FieldErrors {
  [field: string]: string;
}

interface NamespaceFormData {
  name: string;
  description: string;
  uri: string;
}

const EMPTY_FORM: NamespaceFormData = { name: '', description: '', uri: '' };

export function NamespaceManager() {
  const queryClient = useQueryClient();

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<Namespace | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<NamespaceFormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState('');

  // Fetch namespaces
  const { data: namespaces = [], isLoading } = useQuery<Namespace[]>({
    queryKey: ['namespaces'],
    queryFn: getNamespaces,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; uri: string }) =>
      createNamespace(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      resetForm();
    },
    onError: (error: Error) => handleApiError(error),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string; uri?: string } }) =>
      updateNamespace(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      resetForm();
    },
    onError: (error: Error) => handleApiError(error),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNamespace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['namespaces'] });
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setDeleteConfirmId(null);
    },
    onError: (error: Error) => {
      setGeneralError(error instanceof ApiError ? error.message : 'Failed to delete namespace');
      setDeleteConfirmId(null);
    },
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

  function resetForm() {
    setFormData(EMPTY_FORM);
    setFieldErrors({});
    setGeneralError('');
    setShowForm(false);
    setEditingNamespace(null);
  }

  function startCreate() {
    setEditingNamespace(null);
    setFormData(EMPTY_FORM);
    setFieldErrors({});
    setGeneralError('');
    setShowForm(true);
  }

  function startEdit(ns: Namespace) {
    setEditingNamespace(ns);
    setFormData({
      name: ns.name,
      description: ns.description ?? '',
      uri: ns.uri,
    });
    setFieldErrors({});
    setGeneralError('');
    setShowForm(true);
  }

  function validateForm(): boolean {
    const errors: FieldErrors = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    if (!formData.uri.trim()) {
      errors.uri = 'URI is required';
    }

    setFieldErrors(errors);
    setGeneralError('');
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!validateForm()) return;

    if (editingNamespace) {
      updateMutation.mutate({
        id: editingNamespace.id,
        data: {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          uri: formData.uri.trim(),
        },
      });
    } else {
      createMutation.mutate({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        uri: formData.uri.trim(),
      });
    }
  }

  const deleteTarget = namespaces.find((ns) => ns.id === deleteConfirmId);

  if (isLoading) {
    return (
      <div className="text-sm text-gray-500">Loading namespaces...</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Namespaces</h2>
        {!showForm && (
          <Button size="sm" onClick={startCreate}>
            Add Namespace
          </Button>
        )}
      </div>

      {generalError && !showForm && (
        <Alert variant="error">{generalError}</Alert>
      )}

      {/* Namespace list */}
      {namespaces.length === 0 && !showForm && (
        <p className="text-sm text-gray-500">No namespaces defined yet.</p>
      )}

      {namespaces.length > 0 && (
        <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
          {namespaces.map((ns) => (
            <div key={ns.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{ns.name}</p>
                <p className="text-xs text-gray-500 truncate">{ns.uri}</p>
                {ns.description && (
                  <p className="text-xs text-gray-400 truncate">{ns.description}</p>
                )}
              </div>
              <div className="ml-4 flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {ns.nodeCount ?? 0} node{(ns.nodeCount ?? 0) !== 1 ? 's' : ''}
                </span>
                <Button variant="ghost" size="sm" onClick={() => startEdit(ns)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(ns.id)}>
                  <span className="text-danger-600">Delete</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Delete this namespace?"
        message={`This will permanently delete "${deleteTarget?.name ?? ''}" and all its object nodes and variable nodes. This action cannot be undone.`}
        confirmLabel={deleteMutation.isPending ? 'Deleting...' : 'Yes, Delete'}
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId);
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />

      {/* Create/Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            {editingNamespace ? 'Edit Namespace' : 'New Namespace'}
          </h3>

          {generalError && <Alert variant="error">{generalError}</Alert>}

          <FormField id="ns-name" label="Name" required error={fieldErrors.name}>
            <Input
              id="ns-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              error={!!fieldErrors.name}
              placeholder="e.g., PlantFloor"
              aria-required="true"
              aria-describedby={fieldErrors.name ? 'ns-name-error' : undefined}
            />
          </FormField>

          <FormField id="ns-uri" label="URI" required error={fieldErrors.uri}>
            <Input
              id="ns-uri"
              value={formData.uri}
              onChange={(e) => setFormData({ ...formData, uri: e.target.value })}
              error={!!fieldErrors.uri}
              placeholder="e.g., urn:opcua-light:PlantFloor"
              aria-required="true"
              aria-describedby={fieldErrors.uri ? 'ns-uri-error' : undefined}
            />
          </FormField>

          <FormField id="ns-description" label="Description" error={fieldErrors.description}>
            <Input
              id="ns-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
            />
          </FormField>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="submit" loading={isSubmitting}>
              {editingNamespace ? 'Update Namespace' : 'Create Namespace'}
            </Button>
            <Button variant="secondary" type="button" onClick={resetForm} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

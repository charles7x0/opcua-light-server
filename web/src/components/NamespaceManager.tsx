import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNamespaces,
  createNamespace,
  updateNamespace,
  deleteNamespace,
  ApiError,
  type Namespace,
} from '../api';

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

  function confirmDelete(id: string) {
    setDeleteConfirmId(id);
  }

  function executeDelete() {
    if (deleteConfirmId) {
      deleteMutation.mutate(deleteConfirmId);
    }
  }

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
          <button
            onClick={startCreate}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Add Namespace
          </button>
        )}
      </div>

      {generalError && !showForm && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {generalError}
        </div>
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
                <button
                  onClick={() => startEdit(ns)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
                <button
                  onClick={() => confirmDelete(ns.id)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Delete this namespace?
          </p>
          <p className="mt-1 text-sm text-red-700">
            This will permanently delete the namespace and all its object nodes and variable nodes.
            This action cannot be undone.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              onClick={executeDelete}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleteMutation.isPending}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create/Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            {editingNamespace ? 'Edit Namespace' : 'New Namespace'}
          </h3>

          {generalError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {generalError}
            </div>
          )}

          {/* Name field */}
          <div>
            <label htmlFor="ns-name" className="block text-sm font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="ns-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
                fieldErrors.name
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
              }`}
              placeholder="e.g., PlantFloor"
            />
            {fieldErrors.name && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>
            )}
          </div>

          {/* URI field */}
          <div>
            <label htmlFor="ns-uri" className="block text-sm font-medium text-gray-700">
              URI <span className="text-red-500">*</span>
            </label>
            <input
              id="ns-uri"
              type="text"
              value={formData.uri}
              onChange={(e) => setFormData({ ...formData, uri: e.target.value })}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 ${
                fieldErrors.uri
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
              }`}
              placeholder="e.g., urn:opcua-light:PlantFloor"
            />
            {fieldErrors.uri && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.uri}</p>
            )}
          </div>

          {/* Description field */}
          <div>
            <label htmlFor="ns-description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <input
              id="ns-description"
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Optional description"
            />
            {fieldErrors.description && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.description}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? 'Saving...'
                : editingNamespace
                  ? 'Update Namespace'
                  : 'Create Namespace'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

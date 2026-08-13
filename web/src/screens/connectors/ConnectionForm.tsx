import { useState } from 'react';
import { ConnectorConnection, ParamFieldSchema } from '../../api';
import { Button, Input, FormField, Card, CardHeader, Select } from '../../components';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectionFormProps {
  type: string;
  paramsSchema?: ParamFieldSchema[];
  protocolLabel?: string;
  editingConnection?: ConnectorConnection | null;
  onSubmit: (data: {
    type: string;
    name: string;
    params: Record<string, unknown>;
    pollingIntervalMs?: number;
    reconnectIntervalMs?: number;
    enabled?: boolean;
  }) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

interface KeyValuePair {
  key: string;
  value: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitialSchemaValues(
  schema: ParamFieldSchema[],
  params?: Record<string, unknown>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of schema) {
    const existing = params?.[field.key];
    if (existing !== undefined) {
      values[field.key] = String(existing);
    } else if (field.defaultValue !== undefined) {
      values[field.key] = String(field.defaultValue);
    } else {
      values[field.key] = '';
    }
  }
  return values;
}

function getInitialKeyValuePairs(params?: Record<string, unknown>): KeyValuePair[] {
  if (!params || Object.keys(params).length === 0) {
    return [{ key: '', value: '' }];
  }
  return Object.entries(params).map(([key, value]) => ({ key, value: String(value) }));
}

function buildParamsFromSchema(
  schema: ParamFieldSchema[],
  fieldValues: Record<string, string>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of schema) {
    const raw = fieldValues[field.key] ?? '';
    switch (field.type) {
      case 'number':
        params[field.key] = raw === '' ? undefined : Number(raw);
        break;
      case 'boolean':
        params[field.key] = raw === 'true';
        break;
      default:
        params[field.key] = raw;
        break;
    }
  }
  return params;
}

function buildParamsFromKeyValues(pairs: KeyValuePair[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key) {
      const numVal = Number(pair.value);
      if (!isNaN(numVal) && pair.value.trim() !== '') {
        params[key] = numVal;
      } else if (pair.value === 'true') {
        params[key] = true;
      } else if (pair.value === 'false') {
        params[key] = false;
      } else {
        params[key] = pair.value;
      }
    }
  }
  return params;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectionForm({
  type,
  paramsSchema,
  protocolLabel,
  editingConnection,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: ConnectionFormProps): JSX.Element {
  const hasSchema = !!paramsSchema && paramsSchema.length > 0;

  const [name, setName] = useState(editingConnection?.name ?? '');
  const [pollingIntervalMs, setPollingIntervalMs] = useState(
    String(editingConnection?.pollingIntervalMs ?? 1000)
  );
  const [reconnectIntervalMs, setReconnectIntervalMs] = useState(
    String(editingConnection?.reconnectIntervalMs ?? 5000)
  );
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    hasSchema ? getInitialSchemaValues(paramsSchema, editingConnection?.params) : {}
  );
  const [keyValuePairs, setKeyValuePairs] = useState<KeyValuePair[]>(() =>
    !hasSchema ? getInitialKeyValuePairs(editingConnection?.params) : []
  );
  const [error, setError] = useState('');

  function updateFieldValue(key: string, value: string): void {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateKeyValuePair(index: number, field: 'key' | 'value', value: string): void {
    setKeyValuePairs((prev) => prev.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair)));
  }

  function addKeyValuePair(): void {
    setKeyValuePairs((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeKeyValuePair(index: number): void {
    setKeyValuePairs((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (hasSchema) {
      const requiredMissing = paramsSchema.find(
        (f) => f.required && !fieldValues[f.key]?.trim()
      );
      if (requiredMissing) {
        setError(`${requiredMissing.label} is required`);
        return;
      }
    }
    setError('');

    const params = hasSchema
      ? buildParamsFromSchema(paramsSchema, fieldValues)
      : buildParamsFromKeyValues(keyValuePairs);

    onSubmit({
      type,
      name: name.trim(),
      params,
      pollingIntervalMs: parseInt(pollingIntervalMs, 10),
      reconnectIntervalMs: parseInt(reconnectIntervalMs, 10),
      enabled: editingConnection?.enabled ?? true,
    });
  }

  const label = protocolLabel ?? type;
  const title = editingConnection
    ? `Edit ${label} Connection`
    : `New ${label} Connection`;

  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      {error && <p role="alert" className="mb-3 text-sm text-danger-600">{error}</p>}
      <form onSubmit={handleSubmit} aria-label={title} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Common name field */}
          <FormField id="conn-name" label="Name">
            <Input
              id="conn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Connection name"
            />
          </FormField>

          {/* Schema-driven fields */}
          {hasSchema &&
            paramsSchema.map((field) => {
              const fieldId = `conn-${field.key}`;

              if (field.type === 'boolean') {
                return (
                  <FormField
                    key={field.key}
                    id={fieldId}
                    label={field.label}
                    description={field.description}
                  >
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={fieldValues[field.key] === 'true'}
                      onChange={(e) => updateFieldValue(field.key, String(e.target.checked))}
                      className="mt-2 h-4 w-4 rounded border-gray-300"
                    />
                  </FormField>
                );
              }

              if (field.type === 'select' && field.options) {
                return (
                  <FormField
                    key={field.key}
                    id={fieldId}
                    label={field.label}
                    description={field.description}
                  >
                    <Select
                      id={fieldId}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) => updateFieldValue(field.key, e.target.value)}
                    >
                      <option value="">— Select —</option>
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                );
              }

              // text or number
              return (
                <FormField
                  key={field.key}
                  id={fieldId}
                  label={field.label}
                  description={field.description}
                >
                  <Input
                    id={fieldId}
                    type={field.type}
                    min={field.min}
                    max={field.max}
                    value={fieldValues[field.key] ?? ''}
                    onChange={(e) => updateFieldValue(field.key, e.target.value)}
                    placeholder={field.placeholder}
                  />
                </FormField>
              );
            })}

          {/* Common timing fields */}
          <FormField id="conn-polling" label="Polling (ms)">
            <Input
              id="conn-polling"
              type="number"
              min={100}
              value={pollingIntervalMs}
              onChange={(e) => setPollingIntervalMs(e.target.value)}
            />
          </FormField>
          <FormField id="conn-reconnect" label="Reconnect (ms)">
            <Input
              id="conn-reconnect"
              type="number"
              min={1000}
              value={reconnectIntervalMs}
              onChange={(e) => setReconnectIntervalMs(e.target.value)}
            />
          </FormField>
        </div>

        {/* Generic fallback: key-value pairs for protocols without schema */}
        {!hasSchema && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Parameters</label>
            {keyValuePairs.map((pair, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={pair.key}
                  onChange={(e) => updateKeyValuePair(index, 'key', e.target.value)}
                  placeholder="Key"
                  className="flex-1"
                  aria-label={`Parameter key ${index + 1}`}
                />
                <Input
                  value={pair.value}
                  onChange={(e) => updateKeyValuePair(index, 'value', e.target.value)}
                  placeholder="Value"
                  className="flex-1"
                  aria-label={`Parameter value ${index + 1}`}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => removeKeyValuePair(index)}
                  aria-label={`Remove parameter ${index + 1}`}
                  disabled={keyValuePairs.length <= 1}
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={addKeyValuePair}>
              + Add Parameter
            </Button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button type="submit" loading={isSubmitting}>
            {editingConnection ? 'Update' : 'Create'}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

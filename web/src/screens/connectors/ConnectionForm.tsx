import { useState } from 'react';
import { ConnectorConnection } from '../../api';
import { Button, Input, FormField, Card, CardHeader } from '../../components';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectionFormProps {
  type: string;
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

// ─── Protocol Field Definitions ───────────────────────────────────────────────

interface FieldDef {
  id: string;
  label: string;
  type: 'text' | 'number';
  placeholder?: string;
  min?: number;
  defaultValue: string;
  paramKey: string;
}

const S7_FIELDS: FieldDef[] = [
  { id: 'host', label: 'Host', type: 'text', placeholder: '192.168.1.10', defaultValue: '', paramKey: 'host' },
  { id: 'rack', label: 'Rack', type: 'number', min: 0, defaultValue: '0', paramKey: 'rack' },
  { id: 'slot', label: 'Slot', type: 'number', min: 0, defaultValue: '1', paramKey: 'slot' },
];

const MODBUS_FIELDS: FieldDef[] = [
  { id: 'host', label: 'Host', type: 'text', placeholder: '192.168.1.20', defaultValue: '', paramKey: 'host' },
  { id: 'port', label: 'Port', type: 'number', min: 1, defaultValue: '502', paramKey: 'port' },
  { id: 'unitId', label: 'Unit ID', type: 'number', min: 0, defaultValue: '1', paramKey: 'unitId' },
];

const ETHERNET_IP_FIELDS: FieldDef[] = [
  { id: 'host', label: 'Host', type: 'text', placeholder: '192.168.1.30', defaultValue: '', paramKey: 'host' },
  { id: 'port', label: 'Port', type: 'number', min: 1, defaultValue: '44818', paramKey: 'port' },
  { id: 'slot', label: 'Slot', type: 'number', min: 0, defaultValue: '0', paramKey: 'slot' },
];

const PROTOCOL_FIELDS: Record<string, FieldDef[]> = {
  's7': S7_FIELDS,
  'modbus-tcp': MODBUS_FIELDS,
  'ethernet-ip': ETHERNET_IP_FIELDS,
};

const PROTOCOL_LABELS: Record<string, string> = {
  's7': 'S7',
  'modbus-tcp': 'Modbus TCP',
  'ethernet-ip': 'EtherNet/IP',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProtocolLabel(type: string): string {
  return PROTOCOL_LABELS[type] ?? type;
}

function getInitialFieldValues(fields: FieldDef[], params?: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const existing = params?.[field.paramKey];
    values[field.id] = existing !== undefined ? String(existing) : field.defaultValue;
  }
  return values;
}

function getInitialKeyValuePairs(params?: Record<string, unknown>): KeyValuePair[] {
  if (!params || Object.keys(params).length === 0) {
    return [{ key: '', value: '' }];
  }
  return Object.entries(params).map(([key, value]) => ({ key, value: String(value) }));
}

function buildParamsFromFields(fields: FieldDef[], fieldValues: Record<string, string>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = fieldValues[field.id] ?? field.defaultValue;
    params[field.paramKey] = field.type === 'number' ? Number(raw) : raw;
  }
  return params;
}

function buildParamsFromKeyValues(pairs: KeyValuePair[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key) {
      // Try to parse as number or boolean, otherwise keep as string
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

export function ConnectionForm({ type, editingConnection, onSubmit, onCancel, isSubmitting = false }: ConnectionFormProps): JSX.Element {
  const fields = PROTOCOL_FIELDS[type];
  const isKnownProtocol = !!fields;

  const [name, setName] = useState(editingConnection?.name ?? '');
  const [pollingIntervalMs, setPollingIntervalMs] = useState(
    String(editingConnection?.pollingIntervalMs ?? 1000)
  );
  const [reconnectIntervalMs, setReconnectIntervalMs] = useState(
    String(editingConnection?.reconnectIntervalMs ?? 5000)
  );
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    isKnownProtocol ? getInitialFieldValues(fields, editingConnection?.params) : {}
  );
  const [keyValuePairs, setKeyValuePairs] = useState<KeyValuePair[]>(() =>
    !isKnownProtocol ? getInitialKeyValuePairs(editingConnection?.params) : []
  );
  const [error, setError] = useState('');

  function updateFieldValue(id: string, value: string): void {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
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
    if (isKnownProtocol) {
      const hostField = fields.find((f) => f.paramKey === 'host');
      if (hostField && !fieldValues[hostField.id]?.trim()) {
        setError('Host is required');
        return;
      }
    }
    setError('');

    const params = isKnownProtocol
      ? buildParamsFromFields(fields, fieldValues)
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

  const title = editingConnection
    ? `Edit ${getProtocolLabel(type)} Connection`
    : `New ${getProtocolLabel(type)} Connection`;

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

          {/* Protocol-specific fields for known types */}
          {isKnownProtocol &&
            fields.map((field) => (
              <FormField key={field.id} id={`conn-${field.id}`} label={field.label}>
                <Input
                  id={`conn-${field.id}`}
                  type={field.type}
                  min={field.min}
                  value={fieldValues[field.id] ?? field.defaultValue}
                  onChange={(e) => updateFieldValue(field.id, e.target.value)}
                  placeholder={field.placeholder}
                />
              </FormField>
            ))}

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

        {/* Generic fallback: key-value pairs for unrecognized types */}
        {!isKnownProtocol && (
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

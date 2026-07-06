import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createS7Connection,
  updateS7Connection,
  S7Connection,
  ApiError,
} from '../../api';
import { Button, Input, FormField, Card, CardHeader, Alert } from '../../components';

export interface ConnectionFormData {
  name: string;
  host: string;
  rack: string;
  slot: string;
  pollingIntervalMs: string;
  reconnectIntervalMs: string;
}

export const EMPTY_CONN_FORM: ConnectionFormData = {
  name: '', host: '', rack: '0', slot: '1', pollingIntervalMs: '1000', reconnectIntervalMs: '5000',
};

interface S7ConnectionFormProps {
  editingConn: S7Connection | null;
  initialData: ConnectionFormData;
  onClose: () => void;
}

export function S7ConnectionForm({ editingConn, initialData, onClose }: S7ConnectionFormProps) {
  const queryClient = useQueryClient();
  const [connForm, setConnForm] = useState<ConnectionFormData>(initialData);
  const [connError, setConnError] = useState('');

  const createConnMut = useMutation({
    mutationFn: (d: ConnectionFormData) => createS7Connection({
      name: d.name, host: d.host, rack: parseInt(d.rack), slot: parseInt(d.slot),
      pollingIntervalMs: parseInt(d.pollingIntervalMs), reconnectIntervalMs: parseInt(d.reconnectIntervalMs),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-connections'] });
      queryClient.invalidateQueries({ queryKey: ['s7-status'] });
      onClose();
    },
    onError: (e: Error) => setConnError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const updateConnMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: ConnectionFormData }) => updateS7Connection(id, {
      name: d.name, host: d.host, rack: parseInt(d.rack), slot: parseInt(d.slot),
      pollingIntervalMs: parseInt(d.pollingIntervalMs), reconnectIntervalMs: parseInt(d.reconnectIntervalMs),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s7-connections'] });
      queryClient.invalidateQueries({ queryKey: ['s7-status'] });
      onClose();
    },
    onError: (e: Error) => setConnError(e instanceof ApiError ? e.message : 'Failed'),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!connForm.name.trim() || !connForm.host.trim()) { setConnError('Name and host required'); return; }
    setConnError('');
    editingConn
      ? updateConnMut.mutate({ id: editingConn.id, d: connForm })
      : createConnMut.mutate(connForm);
  }

  return (
    <Card>
      <CardHeader>{editingConn ? 'Edit Connection' : 'New Connection'}</CardHeader>
      {connError && <Alert variant="error" className="mb-3">{connError}</Alert>}
      <form onSubmit={handleSubmit} aria-label={editingConn ? `Edit connection ${editingConn.name}` : 'New S7 connection'} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField id="conn-name" label="Name"><Input id="conn-name" value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} placeholder="PLC-1" /></FormField>
          <FormField id="conn-host" label="Host"><Input id="conn-host" value={connForm.host} onChange={(e) => setConnForm({ ...connForm, host: e.target.value })} placeholder="192.168.1.10" /></FormField>
          <FormField id="conn-rack" label="Rack"><Input id="conn-rack" type="number" min={0} value={connForm.rack} onChange={(e) => setConnForm({ ...connForm, rack: e.target.value })} /></FormField>
          <FormField id="conn-slot" label="Slot"><Input id="conn-slot" type="number" min={0} value={connForm.slot} onChange={(e) => setConnForm({ ...connForm, slot: e.target.value })} /></FormField>
          <FormField id="conn-polling" label="Polling (ms)"><Input id="conn-polling" type="number" min={100} value={connForm.pollingIntervalMs} onChange={(e) => setConnForm({ ...connForm, pollingIntervalMs: e.target.value })} /></FormField>
          <FormField id="conn-reconnect" label="Reconnect (ms)"><Input id="conn-reconnect" type="number" min={1000} value={connForm.reconnectIntervalMs} onChange={(e) => setConnForm({ ...connForm, reconnectIntervalMs: e.target.value })} /></FormField>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="submit" loading={createConnMut.isPending || updateConnMut.isPending}>
            {editingConn ? 'Update' : 'Create'}
          </Button>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

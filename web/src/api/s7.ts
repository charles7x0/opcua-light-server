import { request, BASE_URL, getAuthHeaders } from './client';

export interface S7Connection {
  id: string;
  name: string;
  host: string;
  rack: number;
  slot: number;
  pollingIntervalMs: number;
  reconnectIntervalMs: number;
  enabled: boolean;
  createdAt: string;
}

export interface S7MappingItem {
  id: string;
  connectionId: string;
  nodeId: string;
  plcAddress: string;
  description?: string;
  createdAt: string;
}

export interface S7ConnectionStatus {
  connectionId: string;
  state: 'connected' | 'disconnected' | 'error';
  lastPollAt?: string;
  errorMessage?: string;
}

export interface S7CurrentValue {
  nodeId: string;
  plcAddress: string;
  connectionId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: string;
}

export interface S7MappingImportResult {
  summary: { total: number; succeeded: number; failed: number };
  results: Array<{ row: number; success: boolean; plcAddress?: string; error?: string }>;
}

export interface S7LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  connectionName: string;
  message: string;
}

export function getS7Connections(): Promise<S7Connection[]> {
  return request<S7Connection[]>('/s7/connections');
}

export function createS7Connection(data: {
  name: string;
  host: string;
  rack: number;
  slot: number;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
}): Promise<S7Connection> {
  return request<S7Connection>('/s7/connections', { method: 'POST', body: JSON.stringify(data) });
}

export function updateS7Connection(id: string, data: {
  name?: string;
  host?: string;
  rack?: number;
  slot?: number;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
  enabled?: boolean;
}): Promise<S7Connection> {
  return request<S7Connection>(`/s7/connections/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteS7Connection(id: string): Promise<void> {
  return request<void>(`/s7/connections/${id}`, { method: 'DELETE' });
}

export function getS7Mappings(): Promise<S7MappingItem[]> {
  return request<S7MappingItem[]>('/s7/mappings');
}

export function createS7Mapping(data: {
  connectionId: string;
  nodeId: string;
  plcAddress: string;
  description?: string;
}): Promise<S7MappingItem> {
  return request<S7MappingItem>('/s7/mappings', { method: 'POST', body: JSON.stringify(data) });
}

export function updateS7Mapping(id: string, data: { plcAddress?: string; nodeId?: string; description?: string }): Promise<S7MappingItem> {
  return request<S7MappingItem>(`/s7/mappings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function createS7MappingsBulk(mappings: Array<{
  connectionId: string;
  nodeId: string;
  plcAddress: string;
}>): Promise<Array<{ index: number; success: boolean; data?: S7MappingItem; error?: string }>> {
  return request(`/s7/mappings/bulk`, { method: 'POST', body: JSON.stringify(mappings) });
}

export function deleteS7Mapping(id: string): Promise<void> {
  return request<void>(`/s7/mappings/${id}`, { method: 'DELETE' });
}

export function getS7Status(): Promise<S7ConnectionStatus[]> {
  return request<S7ConnectionStatus[]>('/s7/status');
}

export function getS7Values(): Promise<S7CurrentValue[]> {
  return request<S7CurrentValue[]>('/s7/values');
}

export function exportS7MappingsCsv(): Promise<string> {
  return fetch(`${BASE_URL}/s7/mappings/export/csv`, {
    headers: getAuthHeaders(),
  }).then((res) => {
    if (!res.ok) throw new Error('Export failed');
    return res.text();
  });
}

export function importS7MappingsCsv(csv: string): Promise<S7MappingImportResult> {
  return request<S7MappingImportResult>('/s7/mappings/import/csv', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

export function getS7Logs(since?: string): Promise<S7LogEntry[]> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  return request<S7LogEntry[]>(`/s7/logs${params}`);
}

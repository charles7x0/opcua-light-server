import { request } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Describes a single connection parameter field for dynamic form rendering. */
export interface ParamFieldSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  required: boolean;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  pattern?: string;
  patternMessage?: string;
  description?: string;
}

/** Metadata descriptor for a connector protocol. */
export interface ConnectorMetadata {
  type: string;
  displayName: string;
  description?: string;
  icon?: string;
  version?: string;
  paramsSchema: ParamFieldSchema[];
}

export interface ConnectorConnection {
  id: string;
  type: string;
  name: string;
  params: Record<string, unknown>;
  pollingIntervalMs: number;
  reconnectIntervalMs: number;
  enabled: boolean;
  createdAt: string;
}

export interface ConnectorMapping {
  id: string;
  connectionId: string;
  nodeId: string | null;
  deviceAddress: string;
  description?: string;
  createdAt: string;
}

export interface ConnectorStatus {
  connectionId: string;
  state: 'connected' | 'disconnected' | 'error';
  lastPollAt?: string;
  errorMessage?: string;
}

export interface ConnectorCurrentValue {
  nodeId: string | null;
  deviceAddress: string;
  connectionId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: string;
}

export interface ConnectorMappingImportResult {
  summary: { total: number; succeeded: number; failed: number };
  results: Array<{ row: number; success: boolean; deviceAddress?: string; error?: string }>;
}

// ─── Protocol Discovery ───────────────────────────────────────────────────────

/** Fetch all available connector protocols with their metadata. */
export function fetchProtocols(): Promise<ConnectorMetadata[]> {
  return request<ConnectorMetadata[]>('/connectors/protocols');
}

// ─── Connection CRUD ──────────────────────────────────────────────────────────

export function getConnections(type?: string): Promise<ConnectorConnection[]> {
  const params = type ? `?type=${encodeURIComponent(type)}` : '';
  return request<ConnectorConnection[]>(`/connectors/connections${params}`);
}

export function createConnection(data: {
  type: string;
  name: string;
  params: Record<string, unknown>;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
  enabled?: boolean;
}): Promise<ConnectorConnection> {
  return request<ConnectorConnection>('/connectors/connections', { method: 'POST', body: JSON.stringify(data) });
}

export function updateConnection(id: string, data: {
  name?: string;
  params?: Record<string, unknown>;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
  enabled?: boolean;
}): Promise<ConnectorConnection> {
  return request<ConnectorConnection>(`/connectors/connections/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteConnection(id: string): Promise<void> {
  return request<void>(`/connectors/connections/${id}`, { method: 'DELETE' });
}

// ─── Mapping CRUD ─────────────────────────────────────────────────────────────

export function getMappings(connectionId?: string): Promise<ConnectorMapping[]> {
  const params = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
  return request<ConnectorMapping[]>(`/connectors/mappings${params}`);
}

export function createMapping(data: {
  connectionId: string;
  nodeId?: string;
  deviceAddress: string;
  description?: string;
}): Promise<ConnectorMapping> {
  return request<ConnectorMapping>('/connectors/mappings', { method: 'POST', body: JSON.stringify(data) });
}

export function updateMapping(id: string, data: {
  nodeId?: string;
  deviceAddress?: string;
  description?: string;
}): Promise<ConnectorMapping> {
  return request<ConnectorMapping>(`/connectors/mappings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteMapping(id: string): Promise<void> {
  return request<void>(`/connectors/mappings/${id}`, { method: 'DELETE' });
}

// ─── CSV Import/Export ─────────────────────────────────────────────────────────

export async function exportConnectorMappingsCsv(): Promise<string> {
  const res = await fetch('/api/connectors/mappings/export/csv');
  if (!res.ok) throw new Error('Export failed');
  return res.text();
}

export function importConnectorMappingsCsv(csv: string): Promise<ConnectorMappingImportResult> {
  return request<ConnectorMappingImportResult>('/connectors/mappings/import/csv', { method: 'POST', body: JSON.stringify({ csv }) });
}

// ─── Status & Values ──────────────────────────────────────────────────────────

export function getConnectorStatus(): Promise<ConnectorStatus[]> {
  return request<ConnectorStatus[]>('/connectors/status');
}

export function getConnectorValues(): Promise<ConnectorCurrentValue[]> {
  return request<ConnectorCurrentValue[]>('/connectors/values');
}

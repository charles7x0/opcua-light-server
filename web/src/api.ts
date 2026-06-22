/**
 * API client utility for communicating with the OPC UA Light Server Control API.
 * All requests are proxied through Vite dev server to http://localhost:3000.
 */

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  // Add API key if configured
  const apiKey = localStorage.getItem('opcua-api-key');
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { code: 'UNKNOWN', message: response.statusText } }));
    throw new ApiError(
      response.status,
      body.error?.code || 'UNKNOWN',
      body.error?.message || response.statusText,
      body.error?.details
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

// ─── Server Status ────────────────────────────────────────────────────────────

export interface ServerStatus {
  state: 'running' | 'stopped' | 'error';
  uptime?: number;
  pid?: number;
  connectedClients?: number;
  lastError?: string;
}

export function getServerStatus(): Promise<ServerStatus> {
  return request<ServerStatus>('/server/status');
}

export function startServer(): Promise<{ message: string }> {
  return request('/server/start', { method: 'POST' });
}

export function stopServer(): Promise<{ message: string }> {
  return request('/server/stop', { method: 'POST' });
}

export function reloadServer(): Promise<{ message: string }> {
  return request('/server/reload', { method: 'POST' });
}

// ─── Connected Clients ────────────────────────────────────────────────────────

export interface ClientSession {
  applicationName: string;
  applicationUri: string;
  securityPolicyUri: string;
  clientAddress: string;
  connectTime: string;
  sessionState: 'Created' | 'Activated' | 'Closing';
}

export function getConnectedClients(): Promise<ClientSession[]> {
  return request<ClientSession[]>('/server/clients');
}

// ─── Namespaces ───────────────────────────────────────────────────────────────

export interface Namespace {
  id: string;
  name: string;
  description?: string;
  uri: string;
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export function getNamespaces(): Promise<Namespace[]> {
  return request<Namespace[]>('/namespaces');
}

export function createNamespace(data: { name: string; description?: string; uri: string }): Promise<Namespace> {
  return request<Namespace>('/namespaces', { method: 'POST', body: JSON.stringify(data) });
}

export function updateNamespace(id: string, data: { name?: string; description?: string; uri?: string }): Promise<Namespace> {
  return request<Namespace>(`/namespaces/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteNamespace(id: string): Promise<void> {
  return request<void>(`/namespaces/${id}`, { method: 'DELETE' });
}

// ─── Object Nodes ─────────────────────────────────────────────────────────────

export interface ObjectNode {
  id: string;
  namespaceId: string;
  parentObjectNodeId: string | null;
  name: string;
  children?: ObjectNode[];
  createdAt: string;
}

export function getObjectNodeTree(namespaceId: string): Promise<ObjectNode[]> {
  return request<ObjectNode[]>(`/namespaces/${namespaceId}/object-nodes`);
}

export function createObjectNode(data: { name: string; namespaceId: string; parentObjectNodeId?: string }): Promise<ObjectNode> {
  return request<ObjectNode>('/object-nodes', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteObjectNode(id: string): Promise<void> {
  return request<void>(`/object-nodes/${id}`, { method: 'DELETE' });
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

export interface OpcUaNode {
  id: string;
  namespaceId: string;
  objectNodeId: string | null;
  name: string;
  dataType: string;
  initialValue?: unknown;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export function getNodes(): Promise<OpcUaNode[]> {
  return request<OpcUaNode[]>('/nodes');
}

export function getNode(id: string): Promise<OpcUaNode> {
  return request<OpcUaNode>(`/nodes/${id}`);
}

export function createNode(data: {
  name: string;
  namespaceId: string;
  objectNodeId?: string;
  dataType: string;
  initialValue?: unknown;
  description?: string;
}): Promise<OpcUaNode> {
  return request<OpcUaNode>('/nodes', { method: 'POST', body: JSON.stringify(data) });
}

export function updateNode(id: string, data: Partial<{
  name: string;
  objectNodeId: string | null;
  dataType: string;
  initialValue: unknown;
  description: string;
}>): Promise<OpcUaNode> {
  return request<OpcUaNode>(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteNode(id: string): Promise<void> {
  return request<void>(`/nodes/${id}`, { method: 'DELETE' });
}

export interface CsvImportResult {
  summary: { total: number; succeeded: number; failed: number };
  results: Array<{ row: number; success: boolean; name?: string; error?: string }>;
}

export function exportNodesCsv(): Promise<string> {
  return fetch(`${BASE_URL}/nodes/export/csv`, {
    headers: (() => {
      const h: Record<string, string> = {};
      const apiKey = localStorage.getItem('opcua-api-key');
      if (apiKey) h['X-API-Key'] = apiKey;
      return h;
    })(),
  }).then((res) => {
    if (!res.ok) throw new Error('Export failed');
    return res.text();
  });
}

export function importNodesCsv(csv: string): Promise<CsvImportResult> {
  return request<CsvImportResult>('/nodes/import/csv', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

// ─── Security ─────────────────────────────────────────────────────────────────

export interface SecurityConfig {
  mode: 'None' | 'Sign' | 'SignAndEncrypt';
  certificatePath?: string;
  certificateValid?: boolean;
  privateKeyConfigured: boolean;
  certificateExpiresAt?: string;
  certificateRemainingDays?: number;
}

export interface GenerateCertificateOptions {
  dnsNames?: string[];
  ipAddresses?: string[];
  organization?: string;
  country?: string;
  commonName?: string;
  force?: boolean;
}

export function getSecurityConfig(): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security');
}

export function updateSecurityPolicy(mode: string): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security/policy', { method: 'PUT', body: JSON.stringify({ mode }) });
}

export function uploadCertificate(certificatePath: string, privateKeyPath: string): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security/certificate', {
    method: 'POST',
    body: JSON.stringify({ certificatePath, privateKeyPath }),
  });
}

export function generateCertificate(options: GenerateCertificateOptions = {}): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security/generate', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export function getCertificateDownloadUrl(format?: 'der' | 'pem'): string {
  const base = `${BASE_URL}/security/certificate/download`;
  if (format === 'pem') {
    return `${base}?format=pem`;
  }
  return base;
}

export function browseFiles(options?: { startPath?: string; extensions?: string[] }): Promise<{ selectedPath: string | null }> {
  return request<{ selectedPath: string | null }>('/files/browse', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

// ─── S7 Connections ───────────────────────────────────────────────────────────

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

export interface S7CurrentValue {
  nodeId: string;
  plcAddress: string;
  connectionId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: string;
}

export function getS7Values(): Promise<S7CurrentValue[]> {
  return request<S7CurrentValue[]>('/s7/values');
}

export interface S7MappingImportResult {
  summary: { total: number; succeeded: number; failed: number };
  results: Array<{ row: number; success: boolean; plcAddress?: string; error?: string }>;
}

export function exportS7MappingsCsv(): Promise<string> {
  return fetch(`${BASE_URL}/s7/mappings/export/csv`, {
    headers: (() => {
      const h: Record<string, string> = {};
      const apiKey = localStorage.getItem('opcua-api-key');
      if (apiKey) h['X-API-Key'] = apiKey;
      return h;
    })(),
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

export interface S7LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  connectionName: string;
  message: string;
}

export function getS7Logs(since?: string): Promise<S7LogEntry[]> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  return request<S7LogEntry[]>(`/s7/logs${params}`);
}

// ─── System Logs ──────────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

export function getSystemLogs(options?: { since?: string; level?: string; source?: string }): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (options?.since) params.set('since', options.since);
  if (options?.level) params.set('level', options.level);
  if (options?.source) params.set('source', options.source);
  const qs = params.toString();
  return request<LogEntry[]>(`/logs${qs ? `?${qs}` : ''}`);
}


// ─── PKI Certificates ─────────────────────────────────────────────────────────

export interface PkiCertificate {
  thumbprint: string;
  status: 'trusted' | 'rejected';
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fileSize: number;
}

export function getPkiCertificates(): Promise<PkiCertificate[]> {
  return request<PkiCertificate[]>('/pki/certificates');
}

export function rejectPkiCertificate(thumbprint: string): Promise<void> {
  return request<void>(`/pki/certificates/${thumbprint}/reject`, { method: 'POST' });
}

export function trustPkiCertificate(thumbprint: string): Promise<void> {
  return request<void>(`/pki/certificates/${thumbprint}/trust`, { method: 'POST' });
}

export function deletePkiCertificate(thumbprint: string): Promise<void> {
  return request<void>(`/pki/certificates/${thumbprint}`, { method: 'DELETE' });
}

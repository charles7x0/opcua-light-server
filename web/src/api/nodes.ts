import { request, BASE_URL, getAuthHeaders } from './client';

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

export interface CsvImportResult {
  summary: { total: number; succeeded: number; failed: number };
  results: Array<{ row: number; success: boolean; name?: string; error?: string }>;
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

export function exportNodesCsv(): Promise<string> {
  return fetch(`${BASE_URL}/nodes/export/csv`, {
    headers: getAuthHeaders(),
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

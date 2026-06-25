import { request } from './client';

export interface Namespace {
  id: string;
  name: string;
  description?: string;
  uri: string;
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectNode {
  id: string;
  namespaceId: string;
  parentObjectNodeId: string | null;
  name: string;
  children?: ObjectNode[];
  createdAt: string;
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

export function getObjectNodeTree(namespaceId: string): Promise<ObjectNode[]> {
  return request<ObjectNode[]>(`/namespaces/${namespaceId}/object-nodes`);
}

export function createObjectNode(data: { name: string; namespaceId: string; parentObjectNodeId?: string }): Promise<ObjectNode> {
  return request<ObjectNode>('/object-nodes', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteObjectNode(id: string): Promise<void> {
  return request<void>(`/object-nodes/${id}`, { method: 'DELETE' });
}

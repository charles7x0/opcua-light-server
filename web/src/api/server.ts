import { request } from './client';

export interface ServerStatus {
  state: 'running' | 'stopped' | 'error';
  uptime?: number;
  pid?: number;
  connectedClients?: number;
  lastError?: string;
  /** Primary non-loopback IPv4 address of the server host. */
  hostname?: string;
  /** OPC UA runtime port (default: 4840). */
  opcuaPort?: number;
}

export interface ClientSession {
  applicationName: string;
  applicationUri: string;
  securityPolicyUri: string;
  clientAddress: string;
  connectTime: string;
  sessionState: 'Created' | 'Activated' | 'Closing';
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

export function getConnectedClients(): Promise<ClientSession[]> {
  return request<ClientSession[]>('/server/clients');
}

import { request } from './client';

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

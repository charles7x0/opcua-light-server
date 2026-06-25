/**
 * Shared HTTP client infrastructure for the OPC UA Light Server Control API.
 * All requests are proxied through Vite dev server to http://localhost:3000.
 */

export const BASE_URL = '/api';

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

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

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

/** Helper to get auth headers for raw fetch calls (CSV exports). */
export function getAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const apiKey = localStorage.getItem('opcua-api-key');
  if (apiKey) h['X-API-Key'] = apiKey;
  return h;
}

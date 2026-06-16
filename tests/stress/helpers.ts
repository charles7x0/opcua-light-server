/**
 * Stress Test Helpers
 *
 * Shared utilities for OPC UA stress testing.
 */

import {
  OPCUAClient,
  ClientSession,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  DataType,
  ClientSubscription,
  ClientMonitoredItem,
  TimestampsToReturn,
} from 'node-opcua-client';

// ─── Configuration ────────────────────────────────────────────────────────────

export const DEFAULT_ENDPOINT = 'opc.tcp://localhost:4840';
export const API_BASE = 'http://localhost:3100';

export interface StressConfig {
  endpoint: string;
  numClients: number;
  numVariables: number;
  durationMs: number;
  readIntervalMs: number;
  writeIntervalMs: number;
  securityMode: MessageSecurityMode;
  securityPolicy: SecurityPolicy;
}

export const DEFAULT_CONFIG: StressConfig = {
  endpoint: DEFAULT_ENDPOINT,
  numClients: 10,
  numVariables: 100,
  durationMs: 30_000,
  readIntervalMs: 200,
  writeIntervalMs: 500,
  securityMode: MessageSecurityMode.None,
  securityPolicy: SecurityPolicy.None,
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface StressMetrics {
  clientsConnected: number;
  clientsFailed: number;
  totalReads: number;
  totalWrites: number;
  readErrors: number;
  writeErrors: number;
  avgReadLatencyMs: number;
  avgWriteLatencyMs: number;
  maxReadLatencyMs: number;
  maxWriteLatencyMs: number;
  elapsedMs: number;
}

export class MetricsCollector {
  private readLatencies: number[] = [];
  private writeLatencies: number[] = [];
  clientsConnected = 0;
  clientsFailed = 0;
  totalReads = 0;
  totalWrites = 0;
  readErrors = 0;
  writeErrors = 0;
  private startTime = Date.now();

  recordRead(latencyMs: number): void {
    this.totalReads++;
    this.readLatencies.push(latencyMs);
  }

  recordReadError(): void {
    this.readErrors++;
  }

  recordWrite(latencyMs: number): void {
    this.totalWrites++;
    this.writeLatencies.push(latencyMs);
  }

  recordWriteError(): void {
    this.writeErrors++;
  }

  getReport(): StressMetrics {
    const avgRead = this.readLatencies.length > 0
      ? this.readLatencies.reduce((a, b) => a + b, 0) / this.readLatencies.length
      : 0;
    const avgWrite = this.writeLatencies.length > 0
      ? this.writeLatencies.reduce((a, b) => a + b, 0) / this.writeLatencies.length
      : 0;

    return {
      clientsConnected: this.clientsConnected,
      clientsFailed: this.clientsFailed,
      totalReads: this.totalReads,
      totalWrites: this.totalWrites,
      readErrors: this.readErrors,
      writeErrors: this.writeErrors,
      avgReadLatencyMs: Math.round(avgRead * 100) / 100,
      avgWriteLatencyMs: Math.round(avgWrite * 100) / 100,
      maxReadLatencyMs: this.readLatencies.length > 0 ? Math.max(...this.readLatencies) : 0,
      maxWriteLatencyMs: this.writeLatencies.length > 0 ? Math.max(...this.writeLatencies) : 0,
      elapsedMs: Date.now() - this.startTime,
    };
  }
}

// ─── Client Factory ───────────────────────────────────────────────────────────

export async function createClient(config: StressConfig): Promise<{ client: OPCUAClient; session: ClientSession }> {
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: config.securityMode,
    securityPolicy: config.securityPolicy,
    requestedSessionTimeout: 60_000,
    connectionStrategy: {
      maxRetry: 2,
      initialDelay: 500,
      maxDelay: 2000,
    },
  });

  await client.connect(config.endpoint);
  const session = await client.createSession();
  return { client, session };
}

export async function disconnectClient(client: OPCUAClient, session: ClientSession): Promise<void> {
  try {
    await session.close();
    await client.disconnect();
  } catch {
    // Ignore disconnect errors during stress testing
  }
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`API ${method} ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createNamespace(name: string, uri: string): Promise<{ id: string }> {
  return apiRequest('POST', '/api/namespaces', { name, description: 'Stress test namespace', uri });
}

export async function createObjectNode(name: string, namespaceId: string): Promise<{ id: string }> {
  return apiRequest('POST', '/api/object-nodes', { name, namespaceId });
}

export async function createNode(
  name: string,
  dataType: string,
  namespaceId: string,
  objectNodeId: string
): Promise<{ id: string }> {
  return apiRequest('POST', '/api/nodes', { name, dataType, namespaceId, objectNodeId });
}

export async function reloadServer(): Promise<void> {
  await apiRequest('POST', '/api/server/reload', {});
}

export async function getServerStatus(): Promise<{ state: string; connectedClients: number }> {
  return apiRequest('GET', '/api/server/status');
}

export async function getConnectedClients(): Promise<unknown[]> {
  return apiRequest('GET', '/api/server/clients');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function printReport(title: string, metrics: StressMetrics): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Duration:            ${(metrics.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  Clients connected:   ${metrics.clientsConnected}`);
  console.log(`  Clients failed:      ${metrics.clientsFailed}`);
  console.log(`  Total reads:         ${metrics.totalReads}`);
  console.log(`  Total writes:        ${metrics.totalWrites}`);
  console.log(`  Read errors:         ${metrics.readErrors}`);
  console.log(`  Write errors:        ${metrics.writeErrors}`);
  console.log(`  Avg read latency:    ${metrics.avgReadLatencyMs}ms`);
  console.log(`  Max read latency:    ${metrics.maxReadLatencyMs}ms`);
  console.log(`  Avg write latency:   ${metrics.avgWriteLatencyMs}ms`);
  console.log(`  Max write latency:   ${metrics.maxWriteLatencyMs}ms`);
  console.log(`  Reads/sec:           ${(metrics.totalReads / (metrics.elapsedMs / 1000)).toFixed(1)}`);
  console.log(`  Writes/sec:          ${(metrics.totalWrites / (metrics.elapsedMs / 1000)).toFixed(1)}`);
  console.log(`${'═'.repeat(60)}\n`);
}

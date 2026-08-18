/**
 * Internal types for the S7 Connector module.
 * These types are NOT exported from the connectors barrel —
 * they are implementation details of the S7 connector.
 */

import type NodeS7 from 'nodes7';
import type { ConnectionConfig, ConnectionStatus, Mapping } from '../../core/types.js';

/** Type alias for a nodes7 client instance. */
export type NodeS7Instance = InstanceType<typeof NodeS7>;

/**
 * A log entry from the S7 connector (kept for API compatibility).
 */
export interface S7LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  connectionName: string;
  message: string;
}

/**
 * Represents a single managed PLC connection with its polling state.
 * Uses the shared ConnectionConfig and Mapping types from the connector interface.
 */
export interface ManagedConnection {
  config: ConnectionConfig;
  client: NodeS7Instance | null;
  state: ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, Mapping>;
  connecting: boolean;
}

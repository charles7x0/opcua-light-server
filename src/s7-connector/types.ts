/**
 * Types and interfaces for the S7 Connector module.
 */

import type NodeS7 from 'nodes7';
import type { S7ConnectionConfig, S7ConnectionStatus, S7Mapping } from '../types/index.js';

/** Type alias for a nodes7 client instance. */
export type NodeS7Instance = InstanceType<typeof NodeS7>;

/**
 * Value update emitted when a PLC variable is read successfully.
 */
export interface S7ValueUpdate {
  nodeId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: Date;
}

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
 * Callback type for value update notifications.
 */
export type ValueUpdateCallback = (updates: S7ValueUpdate[]) => void;

/**
 * Represents a single managed PLC connection with its polling state.
 */
export interface ManagedConnection {
  config: S7ConnectionConfig;
  client: NodeS7Instance | null;
  state: S7ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, S7Mapping>; // mapping id -> mapping
  connecting: boolean;
}

/**
 * Snapshot of the last-read value for a mapped variable.
 */
export interface S7CurrentValue {
  nodeId: string;
  plcAddress: string;
  connectionId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: string;
}

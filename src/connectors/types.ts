/** Protocol type discriminator string. */
export type ConnectorType = 's7' | 'modbus-tcp' | 'ethernet-ip' | string;

/** Protocol-agnostic connection configuration. */
export interface ConnectionConfig {
  id: string;
  type: ConnectorType;
  name: string;
  params: Record<string, unknown>;
  pollingIntervalMs: number;
  reconnectIntervalMs: number;
  enabled: boolean;
  createdAt: string;
}

/** Protocol-agnostic mapping between a device address and an OPC UA node. */
export interface Mapping {
  id: string;
  connectionId: string;
  nodeId: string | null;
  deviceAddress: string;
  description?: string;
  createdAt: string;
}

/** Value update emitted by connectors after a poll cycle. */
export interface ValueUpdate {
  nodeId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: Date;
}

/** Connection status report. */
export interface ConnectionStatus {
  connectionId: string;
  state: 'connected' | 'disconnected' | 'error';
  lastPollAt?: string;
  errorMessage?: string;
}

/** Current value snapshot for a mapped variable. */
export interface CurrentValue {
  nodeId: string | null;
  deviceAddress: string;
  connectionId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: string;
}

/** Callback type for value update notifications. */
export type ValueUpdateCallback = (updates: ValueUpdate[]) => void;

/**
 * The interface all protocol connectors must implement.
 * Each connector manages one or more connections of the same protocol type.
 */
export interface Connector {
  /** Returns the protocol type identifier (e.g., "s7", "modbus-tcp"). */
  getType(): ConnectorType;

  /** Start all enabled connections and begin polling. */
  start(): void;

  /** Stop all connections and release resources. */
  stop(): void;

  /** Register a new connection configuration. */
  addConnection(config: ConnectionConfig): void;

  /** Remove a connection and clean up associated resources. */
  removeConnection(id: string): void;

  /** Apply configuration changes to an existing connection. */
  updateConnection(config: ConnectionConfig): void;

  /** Associate a device address with an OPC UA node. */
  addMapping(mapping: Mapping): void;

  /** Remove an address-to-node association. */
  removeMapping(id: string): void;

  /** Get connection status for all managed connections. */
  getStatus(): ConnectionStatus[];

  /** Get the last-read value for all mapped variables. */
  getCurrentValues(): CurrentValue[];

  /** Register callback for batched value updates after each poll cycle. */
  onValueUpdate(callback: ValueUpdateCallback): void;
}

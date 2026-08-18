/** Protocol type discriminator string. */
export type ConnectorType = 's7' | 'modbus-tcp' | 'ethernet-ip' | 'pccc' | string;

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

/** Describes a single connection parameter field. */
export interface ParamFieldSchema {
  /** Internal field key (used in params Record). */
  key: string;
  /** Human-readable label for the form field. */
  label: string;
  /** Input type for rendering. */
  type: 'text' | 'number' | 'boolean' | 'select';
  /** Whether this field is required. */
  required: boolean;
  /** Default value (as string for form pre-fill). */
  defaultValue?: string | number | boolean;
  /** Placeholder text for text/number inputs. */
  placeholder?: string;
  /** Minimum value for number fields. */
  min?: number;
  /** Maximum value for number fields. */
  max?: number;
  /** Options for select fields. */
  options?: { value: string; label: string }[];
  /** Validation pattern (regex string) for text fields. */
  pattern?: string;
  /** Validation error message when pattern fails. */
  patternMessage?: string;
  /** Field description/help text. */
  description?: string;
}

/** Metadata descriptor for a connector plugin. */
export interface ConnectorMetadata {
  /** Protocol identifier string (e.g., 's7', 'modbus-tcp'). Must be unique. */
  type: ConnectorType;
  /** Human-readable display name (e.g., 'Siemens S7'). */
  displayName: string;
  /** Optional protocol description. */
  description?: string;
  /** Icon identifier or emoji for UI display. */
  icon?: string;
  /** Optional plugin version (e.g., '1.0.0'). Useful for debugging. */
  version?: string;
  /** Typed schema of connection parameters for dynamic form rendering. */
  paramsSchema: ParamFieldSchema[];
}

/**
 * Extended Connector interface for plugin-based connectors.
 * Adds metadata support to the base Connector interface.
 */
export interface ConnectorPlugin extends Connector {
  /** Returns the metadata descriptor for this connector's protocol. */
  getMetadata(): ConnectorMetadata;
}

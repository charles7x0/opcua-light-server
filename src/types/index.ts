/**
 * Core domain types for OPC UA Light Server.
 */

/** Supported OPC UA data types for variable nodes. */
export type OpcUaDataType =
  | 'Boolean'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Float'
  | 'Double'
  | 'String'
  | 'DateTime'
  | 'ByteString';

/** An OPC UA variable node with metadata. */
export interface OpcUaNode {
  id: string;
  namespaceId: string;
  objectNodeId: string | null;
  name: string;
  dataType: OpcUaDataType;
  initialValue?: unknown;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/** A namespace grouping within the address space. */
export interface Namespace {
  id: string;
  name: string;
  description?: string;
  uri: string;
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** An OPC UA object node (container) within a namespace. Uses HasComponent references. */
export interface ObjectNode {
  id: string;
  namespaceId: string;
  parentObjectNodeId: string | null;
  name: string;
  children?: ObjectNode[];
  createdAt: string;
}

/** OPC UA security configuration. */
export interface SecurityConfig {
  mode: 'None' | 'Sign' | 'SignAndEncrypt';
  certificatePath?: string;
  certificateValid?: boolean;
  privateKeyConfigured: boolean;
}

/** Runtime server status. */
export interface ServerStatus {
  state: 'running' | 'stopped' | 'error';
  uptime?: number;
  pid?: number;
  connectedClients?: number;
  lastError?: string;
}

/** Result returned when the runtime process starts successfully. */
export interface StartResult {
  pid: number;
  startedAt: Date;
}

/** S7 PLC connection configuration. */
export interface S7ConnectionConfig {
  id: string;
  name: string;
  host: string;
  rack: number;
  slot: number;
  pollingIntervalMs: number;
  reconnectIntervalMs: number;
  enabled: boolean;
  createdAt: string;
}

/** Mapping between a PLC variable and an OPC UA node. */
export interface S7Mapping {
  id: string;
  connectionId: string;
  nodeId: string;
  plcAddress: string;
  description?: string;
  createdAt: string;
}

/** Status of an S7 PLC connection. */
export interface S7ConnectionStatus {
  connectionId: string;
  state: 'connected' | 'disconnected' | 'error';
  lastPollAt?: string;
  errorMessage?: string;
}

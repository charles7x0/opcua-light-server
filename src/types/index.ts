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
  /** Whether the configured certificate is valid (file exists, parseable, and not expired). Undefined when no certificate is configured. */
  certificateValid?: boolean;
  privateKeyConfigured: boolean;
  /** Certificate expiry date as ISO string (if certificate is configured) */
  certificateExpiresAt?: string;
  /** Remaining days until certificate expiry (if certificate is configured) */
  certificateRemainingDays?: number;
}

/** Runtime server status. */
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

/** Result returned when the runtime process starts successfully. */
export interface StartResult {
  pid: number;
  startedAt: Date;
}




/** Session state for a connected OPC UA client. */
export type ClientSessionState = 'Created' | 'Activated' | 'Closing';

/** A connected OPC UA client session as reported by the runtime. */
export interface ClientSession {
  applicationName: string;
  applicationUri: string;
  securityPolicyUri: string;
  clientAddress: string;
  connectTime: string; // ISO 8601
  sessionState: ClientSessionState;
}
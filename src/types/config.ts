/**
 * Configuration types for the JSON contract between the Control API and the open62541 runtime.
 * The Config Generator produces this structure; the C runtime consumes it.
 */

import type { OpcUaDataType } from './index.js';

/** Top-level address space configuration written to disk for the runtime. */
export interface AddressSpaceConfig {
  version: number;
  generatedAt: string;
  security: SecurityConfigOutput;
  namespaces: NamespaceConfig[];
}

/** Security section of the runtime configuration. */
export interface SecurityConfigOutput {
  mode: 'None' | 'Sign' | 'SignAndEncrypt';
  certificatePath?: string;
  privateKeyPath?: string;
  /** OPC UA Application URI that must match the certificate's SubjectAltName URI entry. */
  applicationUri?: string;
  /** Absolute path to the PKI trusted certificates directory. Present only when mode is Sign or SignAndEncrypt. */
  pkiTrustedPath?: string;
  /** Absolute path to the PKI rejected certificates directory. Present only when mode is Sign or SignAndEncrypt. */
  pkiRejectedPath?: string;
}

/** A namespace entry in the runtime configuration. */
export interface NamespaceConfig {
  name: string;
  uri: string;
  objectNodes: ObjectNodeConfig[];
  nodes: NodeConfig[];
}

/** An object node entry in the runtime configuration (recursive). */
export interface ObjectNodeConfig {
  name: string;
  path: string;
  children: ObjectNodeConfig[];
}

/** A node entry in the runtime configuration. */
export interface NodeConfig {
  name: string;
  nodeId: string;
  dataType: OpcUaDataType;
  parentPath: string;
  initialValue?: unknown;
  connectorMapping?: ConnectorMappingConfig;
  s7Mapping?: S7MappingConfig;
}

/** Protocol-agnostic connector mapping attached to a node in the runtime configuration. */
export interface ConnectorMappingConfig {
  connectionType: string;
  connectionHost: string;
  deviceAddress: string;
}

/** S7 mapping attached to a node in the runtime configuration. */
export interface S7MappingConfig {
  connectionHost: string;
  plcAddress: string;
}

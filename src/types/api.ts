/**
 * Request/response DTOs and error format for the Control API.
 */

import type { OpcUaDataType } from './index.js';

// --- Error Response Format ---

/** A single field-level validation error detail. */
export interface ErrorDetail {
  field: string;
  message: string;
}

/** Standard API error response body. */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}

/** Known error codes returned by the API. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'RUNTIME_ERROR'
  | 'CERTIFICATE_NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'CONFLICT';

// --- Node DTOs ---

/** Request body for creating a node. */
export interface CreateNodeRequest {
  name: string;
  namespaceId: string;
  objectNodeId?: string | null;
  dataType: OpcUaDataType;
  initialValue?: unknown;
  description?: string;
}

/** Request body for updating a node. */
export interface UpdateNodeRequest {
  name?: string;
  objectNodeId?: string | null;
  dataType?: OpcUaDataType;
  initialValue?: unknown;
  description?: string;
}

// --- Namespace DTOs ---

/** Request body for creating a namespace. */
export interface CreateNamespaceRequest {
  name: string;
  description?: string;
  uri: string;
}

/** Request body for updating a namespace. */
export interface UpdateNamespaceRequest {
  name?: string;
  description?: string;
  uri?: string;
}

// --- Object Node DTOs ---

/** Request body for creating an object node. */
export interface CreateObjectNodeRequest {
  name: string;
  namespaceId: string;
  parentObjectNodeId?: string | null;
}

// --- Security DTOs ---

/** Request body for updating the security policy. */
export interface UpdateSecurityPolicyRequest {
  mode: 'None' | 'Sign' | 'SignAndEncrypt';
}

/** Request body for uploading a certificate. */
export interface UploadCertificateRequest {
  certificatePath: string;
  privateKeyPath: string;
}

/** Request body for generating a self-signed certificate. */
export interface GenerateCertificateRequest {
  /** Subject Alternative Name DNS entries (optional, industrial environments often lack DNS) */
  dnsNames?: string[];
  /** Subject Alternative Name IP entries (auto-detected if not provided) */
  ipAddresses?: string[];
  /** Organization name for the certificate subject */
  organization?: string;
  /** Country code (2-letter) */
  country?: string;
  /** Common Name for the certificate subject */
  commonName?: string;
  /** Force overwrite if certificate already exists (required: true) */
  force?: boolean;
}

// --- S7 DTOs ---

/** Request body for creating an S7 connection. */
export interface CreateS7ConnectionRequest {
  name: string;
  host: string;
  rack: number;
  slot: number;
  pollingIntervalMs?: number;
  reconnectIntervalMs?: number;
  enabled?: boolean;
}

/** Request body for creating an S7 mapping. */
export interface CreateS7MappingRequest {
  connectionId: string;
  nodeId: string;
  plcAddress: string;
  description?: string;
}

// --- Server Lifecycle DTOs ---

/** Response from the start endpoint. */
export interface StartServerResponse {
  pid: number;
  startedAt: string;
}

/** Generic success response for operations without a body. */
export interface SuccessResponse {
  success: boolean;
  message?: string;
}

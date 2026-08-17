/**
 * API client barrel export.
 * All consumers import from '../../api' — this re-exports everything
 * so the split into domain modules is transparent.
 */

export { ApiError } from './client';
export type { ServerStatus, ClientSession } from './server';
export { getServerStatus, startServer, stopServer, reloadServer, getConnectedClients } from './server';
export type { Namespace, ObjectNode } from './namespaces';
export { getNamespaces, createNamespace, updateNamespace, deleteNamespace, getObjectNodeTree, createObjectNode, deleteObjectNode } from './namespaces';
export type { OpcUaNode, CsvImportResult } from './nodes';
export { getNodes, getNode, createNode, updateNode, deleteNode, exportNodesCsv, importNodesCsv } from './nodes';
export type { SecurityConfig, GenerateCertificateOptions } from './security';
export { getSecurityConfig, updateSecurityPolicy, uploadCertificate, generateCertificate, getCertificateDownloadUrl, browseFiles } from './security';
export type { LogEntry } from './logs';
export { getSystemLogs } from './logs';
export type { PkiCertificate } from './pki';
export { getPkiCertificates, rejectPkiCertificate, trustPkiCertificate, deletePkiCertificate } from './pki';
export type { ConnectorConnection, ConnectorMapping, ConnectorStatus, ConnectorCurrentValue, ConnectorMappingImportResult, ParamFieldSchema, ConnectorMetadata } from './connectors';
export { getConnections, createConnection, updateConnection, deleteConnection, getMappings, createMapping, updateMapping, deleteMapping, getConnectorStatus, getConnectorValues, exportConnectorMappingsCsv, importConnectorMappingsCsv, fetchProtocols } from './connectors';

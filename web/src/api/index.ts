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
export type { S7Connection, S7MappingItem, S7ConnectionStatus, S7CurrentValue, S7MappingImportResult, S7LogEntry } from './s7';
export { getS7Connections, createS7Connection, updateS7Connection, deleteS7Connection, getS7Mappings, createS7Mapping, updateS7Mapping, createS7MappingsBulk, deleteS7Mapping, getS7Status, getS7Values, exportS7MappingsCsv, importS7MappingsCsv, getS7Logs } from './s7';
export type { LogEntry } from './logs';
export { getSystemLogs } from './logs';
export type { PkiCertificate } from './pki';
export { getPkiCertificates, rejectPkiCertificate, trustPkiCertificate, deletePkiCertificate } from './pki';

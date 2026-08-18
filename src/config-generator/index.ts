import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Database } from '../db/database.js';
import type {
  AddressSpaceConfig,
  SecurityConfigOutput,
  NamespaceConfig,
  ObjectNodeConfig,
  NodeConfig,
  ConnectorMappingConfig,
} from '../types/config.js';
import type { OpcUaDataType } from '../types/index.js';
import { logService } from '../log/index.js';

/** Row shape from the namespaces table. */
interface NamespaceRow {
  id: string;
  name: string;
  uri: string;
}

/** Row shape from the object_nodes table. */
interface ObjectNodeRow {
  id: string;
  namespace_id: string;
  parent_object_node_id: string | null;
  name: string;
}

/** Row shape from the nodes table. */
interface NodeRow {
  id: string;
  namespace_id: string;
  object_node_id: string | null;
  name: string;
  data_type: string;
  initial_value: string | null;
}

/** Row shape from the security_config table. */
interface SecurityConfigRow {
  mode: string;
  certificate_path: string | null;
  private_key_path: string | null;
}

/** Row shape from the generalized mappings table joined with connections. */
interface ConnectorMappingRow {
  node_id: string;
  device_address: string;
  type: string;
  params: string;
}

/**
 * ConfigGenerator reads the current state from SQLite and produces
 * the JSON configuration file consumed by the open62541 runtime.
 */
export class ConfigGenerator {
  constructor(
    private readonly database: Database,
  ) {}

  /**
   * Generate the full AddressSpaceConfig from the current database state.
   */
  generate(): AddressSpaceConfig {
    const db = this.database.getConnection();

    const security = this.buildSecurityConfig(db);
    const namespaces = this.buildNamespaces(db);

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      security,
      namespaces,
    };
  }

  /**
   * Generate the config and write it as JSON to the specified file path.
   */
  writeToFile(path: string): void {
    const config = this.generate();
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Build the security configuration section from the security_config table.
   * Unlike the SecurityRepository.get() method, this includes the private key path
   * because the runtime needs it to load certificates.
   *
   * If mode requires encryption but certificate/key paths are missing,
   * falls back to "None" to prevent the runtime from crashing on startup.
   *
   * When mode is Sign or SignAndEncrypt, includes pkiTrustedPath and pkiRejectedPath
   * with absolute paths to the PKI directories. Falls back to "None" if the
   * PKI directories do not exist.
   */
  private buildSecurityConfig(db: import('better-sqlite3').Database): SecurityConfigOutput {
    const row = db.prepare(
      'SELECT mode, certificate_path, private_key_path FROM security_config WHERE id = 1'
    ).get() as SecurityConfigRow | undefined;

    if (!row) {
      return { mode: 'None' };
    }

    // If encryption is requested but cert/key paths are not configured,
    // fall back to None to avoid a runtime crash (exit code 1).
    if (row.mode !== 'None' && (!row.certificate_path || !row.private_key_path)) {
      logService.warn(
        'ConfigGenerator',
        `Security mode "${row.mode}" requires certificatePath and privateKeyPath. ` +
        `Falling back to "None" because one or both are missing.`
      );
      return { mode: 'None' };
    }

    const config: SecurityConfigOutput = {
      mode: row.mode as SecurityConfigOutput['mode'],
    };

    if (row.certificate_path) {
      config.certificatePath = row.certificate_path;
    }

    if (row.private_key_path) {
      config.privateKeyPath = row.private_key_path;
    }

    // Include the applicationUri so the runtime can match it to the certificate's SAN
    if (row.mode !== 'None') {
      config.applicationUri = 'urn:opcua-light-server:application';

      // Include PKI paths for TOFU certificate verification
      const pkiTrustedPath = resolve('data/pki/trusted');
      const pkiRejectedPath = resolve('data/pki/rejected');

      if (!existsSync(pkiTrustedPath) || !existsSync(pkiRejectedPath)) {
        const missing = !existsSync(pkiTrustedPath) ? 'pkiTrustedPath' : 'pkiRejectedPath';
        logService.warn(
          'ConfigGenerator',
          `Security mode "${row.mode}" requires PKI directories but ` +
          `${missing} does not exist. Falling back to mode "None".`
        );
        return { mode: 'None' };
      }

      config.pkiTrustedPath = pkiTrustedPath;
      config.pkiRejectedPath = pkiRejectedPath;
    }

    return config;
  }

  /**
   * Build the namespaces array with object nodes and variable nodes for each namespace.
   */
  private buildNamespaces(db: import('better-sqlite3').Database): NamespaceConfig[] {
    const namespaceRows = db.prepare(
      'SELECT id, name, uri FROM namespaces ORDER BY name'
    ).all() as NamespaceRow[];

    return namespaceRows.map((ns, index) => {
      const nsIndex = index + 2; // OPC UA ns=0 is UA standard, ns=1 is server, custom starts at 2
      const objectNodeRows = this.buildObjectNodeTree(db, ns.id);
      const nodes = this.buildNodes(db, ns.id, ns.name, nsIndex, objectNodeRows);

      return {
        name: ns.name,
        uri: ns.uri,
        objectNodes: this.toObjectNodeConfigs(objectNodeRows, ns.name),
        nodes,
      };
    });
  }

  /**
   * Build the object node tree for a namespace, returning a flat list.
   */
  private buildObjectNodeTree(db: import('better-sqlite3').Database, namespaceId: string): ObjectNodeRow[] {
    return db.prepare(
      'SELECT id, namespace_id, parent_object_node_id, name FROM object_nodes WHERE namespace_id = ? ORDER BY name'
    ).all(namespaceId) as ObjectNodeRow[];
  }

  /**
   * Convert flat object node rows into nested ObjectNodeConfig tree.
   */
  private toObjectNodeConfigs(objectNodeRows: ObjectNodeRow[], namespaceName: string): ObjectNodeConfig[] {
    const nodeMap = new Map<string, ObjectNodeConfig>();
    const roots: ObjectNodeConfig[] = [];

    // First pass: create all ObjectNodeConfig objects
    for (const row of objectNodeRows) {
      const path = this.computeObjectNodePath(row.id, objectNodeRows, namespaceName);
      nodeMap.set(row.id, {
        name: row.name,
        path,
        children: [],
      });
    }

    // Second pass: build parent-child relationships
    for (const row of objectNodeRows) {
      const node = nodeMap.get(row.id)!;
      if (row.parent_object_node_id === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(row.parent_object_node_id);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
    }

    return roots;
  }

  /**
   * Compute the dot-separated path from root to the given object node.
   * Format: "NamespaceName.ObjectNodeA.ObjectNodeB"
   */
  private computeObjectNodePath(objectNodeId: string, objectNodeRows: ObjectNodeRow[], namespaceName: string): string {
    const parts: string[] = [];
    let currentId: string | null = objectNodeId;

    const nodeMap = new Map(objectNodeRows.map(n => [n.id, n]));

    while (currentId) {
      const node = nodeMap.get(currentId);
      if (!node) break;
      parts.unshift(node.name);
      currentId = node.parent_object_node_id;
    }

    return [namespaceName, ...parts].join('.');
  }

  /**
   * Build NodeConfig array for all variable nodes in a namespace.
   */
  private buildNodes(
    db: import('better-sqlite3').Database,
    namespaceId: string,
    namespaceName: string,
    nsIndex: number,
    objectNodeRows: ObjectNodeRow[]
  ): NodeConfig[] {
    const nodeRows = db.prepare(
      'SELECT id, namespace_id, object_node_id, name, data_type, initial_value FROM nodes WHERE namespace_id = ? ORDER BY name'
    ).all(namespaceId) as NodeRow[];

    // Pre-load connector mappings for all nodes in this namespace
    const mappings = this.loadMappings(db, namespaceId);

    return nodeRows.map(node => {
      const parentPath = node.object_node_id
        ? this.computeObjectNodePath(node.object_node_id, objectNodeRows, namespaceName)
        : namespaceName;

      const nodeId = `ns=${nsIndex};s=${parentPath}.${node.name}`;

      const config: NodeConfig = {
        name: node.name,
        nodeId,
        dataType: node.data_type as OpcUaDataType,
        parentPath,
      };

      if (node.initial_value !== null) {
        config.initialValue = JSON.parse(node.initial_value);
      }

      const mapping = mappings.get(node.id);
      if (mapping) {
        config.connectorMapping = mapping;

        // Backward compatibility: populate s7Mapping for S7 connections
        if (mapping.connectionType === 's7') {
          config.s7Mapping = {
            connectionHost: mapping.connectionHost,
            plcAddress: mapping.deviceAddress,
          };
        }
      }

      return config;
    });
  }

  /**
   * Load connector mappings for all nodes in a namespace, joining with connections
   * to get the connection type and params.
   */
  private loadMappings(
    db: import('better-sqlite3').Database,
    namespaceId: string
  ): Map<string, ConnectorMappingConfig> {
    const rows = db.prepare(
      `SELECT m.node_id, m.device_address, c.type, c.params
       FROM mappings m
       JOIN connections c ON m.connection_id = c.id
       JOIN nodes n ON m.node_id = n.id
       WHERE n.namespace_id = ?`
    ).all(namespaceId) as ConnectorMappingRow[];

    const map = new Map<string, ConnectorMappingConfig>();
    for (const row of rows) {
      const params = JSON.parse(row.params);
      map.set(row.node_id, {
        connectionType: row.type,
        connectionHost: params.host ?? '',
        deviceAddress: row.device_address,
      });
    }

    return map;
  }
}

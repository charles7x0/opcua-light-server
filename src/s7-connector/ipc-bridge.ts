/**
 * S7 IPC Bridge — translates S7 Connector value updates (database UUIDs)
 * into OPC UA node IDs and forwards them to the runtime process via stdin.
 *
 * Extracted from server.ts to enable isolated testing and reduce entry-point complexity.
 */

import type { S7ValueUpdate } from './index.js';
import type { ConfigGenerator } from '../config-generator/index.js';
import type { ProcessManager } from '../process-manager/index.js';
import type { Database } from '../db/database.js';
import { logService } from '../log/index.js';

/**
 * Bridges S7 Connector value updates to the OPC UA runtime process.
 * Maintains a cached mapping from database node UUIDs to OPC UA node IDs.
 */
export class S7IpcBridge {
  private uuidToOpcUaId: Map<string, string> | null = null;

  constructor(
    private readonly configGenerator: ConfigGenerator,
    private readonly processManager: ProcessManager,
    private readonly database: Database
  ) {}

  /**
   * Handle value updates from the S7 Connector.
   * Resolves UUID node IDs to OPC UA node IDs and writes the JSON message
   * to the runtime's stdin pipe.
   */
  handleValueUpdates(updates: S7ValueUpdate[]): void {
    const status = this.processManager.getStatus();
    if (status.state !== 'running') {
      logService.debug('S7-IPC', `Skipping ${updates.length} update(s): runtime not running`);
      return;
    }

    // Lazily build the map (invalidated on address space changes via auto-reload)
    if (!this.uuidToOpcUaId) {
      this.uuidToOpcUaId = this.buildNodeIdMap();
      logService.info('S7-IPC', `Built node ID map: ${this.uuidToOpcUaId.size} mapping(s)`);
    }

    // Resolve UUIDs to OPC UA node IDs
    const resolvedUpdates = updates
      .filter((u) => {
        if (!this.uuidToOpcUaId!.has(u.nodeId)) {
          // Rebuild map in case a new node was added
          logService.warn('S7-IPC', `Node UUID ${u.nodeId} not in map, rebuilding...`);
          this.uuidToOpcUaId = this.buildNodeIdMap();
          return this.uuidToOpcUaId.has(u.nodeId);
        }
        return true;
      })
      .map((u) => ({
        nodeId: this.uuidToOpcUaId!.get(u.nodeId)!,
        value: u.value,
        quality: u.quality,
        timestamp: u.timestamp.toISOString(),
      }));

    if (resolvedUpdates.length === 0) {
      logService.warn('S7-IPC', `No updates resolved (${updates.length} input, 0 matched)`);
      return;
    }

    const message = JSON.stringify({
      type: 'value_update',
      updates: resolvedUpdates,
    });

    try {
      this.processManager.writeToStdin(message + '\n');
      logService.debug('S7-IPC', `Sent ${resolvedUpdates.length} value(s) to runtime stdin`);
    } catch (err) {
      logService.error('S7-IPC', `Failed to write to stdin: ${(err as Error).message}`);
    }
  }

  /**
   * Invalidate the cached node ID map.
   * Should be called when the address space changes (e.g., after auto-reload).
   */
  invalidateMap(): void {
    this.uuidToOpcUaId = null;
  }

  /**
   * Build the mapping from database node UUIDs to OPC UA node IDs.
   * Uses the ConfigGenerator to produce the full address space config,
   * then correlates node names back to database IDs.
   */
  private buildNodeIdMap(): Map<string, string> {
    const config = this.configGenerator.generate();
    const db = this.database.getConnection();
    const map = new Map<string, string>();

    for (const ns of config.namespaces) {
      for (const node of ns.nodes) {
        const row = db.prepare(
          `SELECT n.id FROM nodes n
           JOIN namespaces ns ON n.namespace_id = ns.id
           WHERE n.name = ? AND ns.name = ?`
        ).get(node.name, ns.name) as { id: string } | undefined;
        if (row) {
          map.set(row.id, node.nodeId);
        }
      }
    }

    return map;
  }
}

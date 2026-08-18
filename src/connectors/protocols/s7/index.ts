import NodeS7 from 'nodes7';
import type {
  ConnectorMetadata,
  ConnectorType,
  ConnectionConfig,
  Mapping,
  ValueUpdate,
} from '../../core/types.js';
import { BaseConnector, type BaseManagedConnection } from '../../core/base-connector.js';

/** Type alias for a nodes7 client instance. */
type NodeS7Instance = InstanceType<typeof NodeS7>;

/**
 * A log entry from the S7 connector (kept for protocol-specific extension API).
 */
export interface S7LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  connectionName: string;
  message: string;
}

/**
 * Represents a single managed PLC connection with its polling state.
 */
interface ManagedS7Connection extends BaseManagedConnection<NodeS7Instance> {
  host: string;
  rack: number;
  slot: number;
}

/** Maximum number of log entries to keep in memory. */
const MAX_LOG_ENTRIES = 1000;

/**
 * S7Connector manages connections to Siemens S7 PLCs, polls mapped variables
 * at configured intervals, and communicates value updates to the runtime.
 *
 * Implements the Connector interface for use within the multi-protocol
 * connector architecture. Maintains automatic reconnection on failure.
 * On connection loss, affected node quality is set to "bad".
 * On reconnection, polling resumes and node quality is restored to "good".
 */
export class S7Connector extends BaseConnector<NodeS7Instance, ManagedS7Connection> {
  private logEntries: S7LogEntry[] = [];

  /** Returns the protocol type identifier. */
  getType(): ConnectorType {
    return 's7';
  }

  /** Returns the metadata descriptor for the S7 connector plugin. */
  getMetadata(): ConnectorMetadata {
    return {
      type: 's7',
      displayName: 'Siemens S7',
      description: 'Connect to S7-300/400/1200/1500 PLCs via ISO-on-TCP',
      icon: '🔌',
      paramsSchema: [
        { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
        { key: 'rack', label: 'Rack', type: 'number', required: false, defaultValue: 0, min: 0 },
        { key: 'slot', label: 'Slot', type: 'number', required: false, defaultValue: 1, min: 0 },
      ],
    };
  }

  /**
   * Get the log entries (most recent last).
   * Optionally filter by a "since" timestamp to get only new entries.
   * This is a protocol-specific extension (not part of Connector interface).
   */
  getLogs(since?: string): S7LogEntry[] {
    if (!since) return [...this.logEntries];
    return this.logEntries.filter((e) => e.timestamp > since);
  }

  /**
   * Override log to also store entries in the ring buffer.
   */
  protected override log(level: S7LogEntry['level'], connectionName: string, message: string): void {
    const entry: S7LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      connectionName,
      message,
    };
    this.logEntries.push(entry);
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries.shift();
    }
    super.log(level, connectionName, message);
  }

  /**
   * Extract S7-specific params (host, rack, slot) from the generic ConnectionConfig.
   */
  protected extractParams(config: ConnectionConfig): { host: string; rack: number; slot: number } {
    const params = config.params;
    const host = params.host as string;
    const rack = (params.rack as number) ?? 0;
    const slot = (params.slot as number) ?? 1;

    if (!host) {
      throw new Error(`S7 connection '${config.name}' requires a 'host' parameter`);
    }

    return { host, rack, slot };
  }

  /**
   * Create a managed S7 connection object.
   */
  protected createManagedConnection(config: ConnectionConfig, params: Record<string, unknown>): ManagedS7Connection {
    return {
      config,
      host: params.host as string,
      rack: params.rack as number,
      slot: params.slot as number,
      client: null,
      state: 'disconnected',
      pollingTimer: null,
      reconnectTimer: null,
      mappings: new Map(),
      connecting: false,
    };
  }

  /**
   * Apply extracted params to the managed connection (used by updateConnection).
   */
  protected applyParams(managed: ManagedS7Connection, params: Record<string, unknown>): void {
    managed.host = params.host as string;
    managed.rack = params.rack as number;
    managed.slot = params.slot as number;
  }

  /**
   * Add a variable mapping between a device address and an OPC UA node.
   * If the connection is active, the item will be added to the poll list immediately.
   */
  override addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    managed.mappings.set(mapping.id, mapping);

    // If connected, add the item to the nodes7 client
    if (managed.state === 'connected' && managed.client) {
      managed.client.addItems(mapping.deviceAddress);
    }
  }

  /**
   * Remove a variable mapping. If the connection is active, the item
   * will be removed from the poll list.
   */
  override removeMapping(id: string): void {
    for (const managed of this.connections.values()) {
      const mapping = managed.mappings.get(id);
      if (mapping) {
        managed.mappings.delete(id);
        // If connected, remove the item from the nodes7 client
        if (managed.state === 'connected' && managed.client) {
          managed.client.removeItems(mapping.deviceAddress);
        }
        this.currentValues.delete(id);
        return;
      }
    }
    throw new Error(`Mapping with id '${id}' not found`);
  }

  /**
   * Initiate a connection to a PLC using nodes7.
   */
  initiateConnection(managed: ManagedS7Connection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    const client = this.createNodeS7Instance();
    managed.client = client;

    const connectionParams = {
      host: managed.host,
      port: 102,
      rack: managed.rack,
      slot: managed.slot,
      timeout: 5000,
    };

    client.initiateConnection(connectionParams, (err: unknown) => {
      managed.connecting = false;

      if (err) {
        this.handleConnectionError(managed, err);
        return;
      }

      // Guard: client may have been nullified by disconnectAndCleanup during
      // the async connection handshake (race condition with stop/reconnect).
      if (!managed.client) {
        this.log('warn', managed.config.name, 'Connection succeeded but client was already cleaned up — ignoring');
        return;
      }

      // Connection successful
      managed.state = 'connected';
      managed.errorMessage = undefined;

      this.log('info', managed.config.name, 'Connected successfully');

      // Add all mapped items to the poll list
      const addresses = Array.from(managed.mappings.values()).map((m) => m.deviceAddress);
      if (addresses.length > 0) {
        managed.client.addItems(addresses);
      }

      // Notify that nodes are now good quality
      this.emitQualityUpdate(managed, 'good');

      // Start polling
      this.startPolling(managed);
    });
  }

  /**
   * Start polling mapped variables at the configured interval.
   */
  startPolling(managed: ManagedS7Connection): void {
    if (managed.pollingTimer) return;

    const poll = (): void => {
      if (managed.state !== 'connected' || !managed.client) return;
      if (managed.mappings.size === 0) return;

      managed.client.readAllItems((err: unknown, values: Record<string, unknown>) => {
        if (err) {
          this.handleConnectionError(managed, err);
          return;
        }

        managed.lastPollAt = new Date();

        const updates: ValueUpdate[] = [];
        for (const mapping of managed.mappings.values()) {
          const value = values[mapping.deviceAddress];
          if (value !== undefined) {
            const now = new Date();
            if (mapping.nodeId) {
              updates.push({
                nodeId: mapping.nodeId,
                value: value,
                quality: 'good',
                timestamp: now,
              });
            }
            this.cacheValue(mapping.id, {
              nodeId: mapping.nodeId,
              deviceAddress: mapping.deviceAddress,
              connectionId: managed.config.id,
              value: value,
              quality: 'good',
              timestamp: now.toISOString(),
            });
          }
        }

        if (updates.length > 0) {
          const valuesSummary = updates.map((u) => {
            const mapping = Array.from(managed.mappings.values()).find((m) => m.nodeId === u.nodeId);
            const addr = mapping?.deviceAddress ?? u.nodeId;
            return `${addr}=${JSON.stringify(u.value)}`;
          }).join(', ');
          this.log('debug', managed.config.name, `Read ${updates.length} var(s): ${valuesSummary}`);
          this.emitValueUpdates(updates);
        }
      });
    };

    poll();
    managed.pollingTimer = setInterval(poll, managed.config.pollingIntervalMs);
  }

  /**
   * Close the nodes7 client connection.
   */
  closeClient(managed: ManagedS7Connection): void {
    if (managed.client) {
      try {
        managed.client.dropConnection(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Create a new nodes7 instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createNodeS7Instance(): NodeS7Instance {
    return new NodeS7({ silent: true });
  }
}

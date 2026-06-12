import NodeS7 from 'nodes7';
import type {
  S7ConnectionConfig,
  S7ConnectionStatus,
  S7Mapping,
} from '../types/index.js';
import { logService } from '../log/index.js';

/**
 * Value update emitted when a PLC variable is read successfully.
 */
export interface S7ValueUpdate {
  nodeId: string;
  value: unknown;
  quality: 'good' | 'bad';
  timestamp: Date;
}

/**
 * A log entry from the S7 connector (kept for API compatibility).
 */
export interface S7LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  connectionName: string;
  message: string;
}

/**
 * Callback type for value update notifications.
 */
export type ValueUpdateCallback = (updates: S7ValueUpdate[]) => void;

/** Maximum number of log entries to keep in memory. */
const MAX_LOG_ENTRIES = 1000;

/**
 * Represents a single managed PLC connection with its polling state.
 */
interface ManagedConnection {
  config: S7ConnectionConfig;
  client: any; // nodes7 instance
  state: S7ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, S7Mapping>; // mapping id -> mapping
  connecting: boolean;
}

/**
 * S7Connector manages connections to Siemens S7 PLCs, polls mapped variables
 * at configured intervals, and communicates value updates to the runtime.
 *
 * Implements connection state management with automatic reconnection on failure.
 * On connection loss, affected node quality is set to "bad".
 * On reconnection, polling resumes and node quality is restored to "good".
 */
export class S7Connector {
  private connections: Map<string, ManagedConnection> = new Map();
  private running = false;
  private valueUpdateCallback: ValueUpdateCallback | null = null;
  private logEntries: S7LogEntry[] = [];

  /**
   * Register a callback to receive value updates from PLC polling.
   * The callback is invoked with batched updates after each poll cycle.
   */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }

  /**
   * Get the log entries (most recent last).
   * Optionally filter by a "since" timestamp to get only new entries.
   */
  getLogs(since?: string): S7LogEntry[] {
    if (!since) return [...this.logEntries];
    return this.logEntries.filter((e) => e.timestamp > since);
  }

  /**
   * Add a log entry to the ring buffer and the central log service.
   */
  private log(level: S7LogEntry['level'], connectionName: string, message: string): void {
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
    // Also write to the central log service
    logService.log(level, `S7:${connectionName}`, message);
  }

  /**
   * Add a new PLC connection configuration.
   * If the connector is already running, the connection will be initiated immediately.
   */
  addConnection(config: S7ConnectionConfig): void {
    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id '${config.id}' already exists`);
    }

    const managed: ManagedConnection = {
      config,
      client: null,
      state: 'disconnected',
      pollingTimer: null,
      reconnectTimer: null,
      mappings: new Map(),
      connecting: false,
    };

    this.connections.set(config.id, managed);

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Remove a PLC connection and clean up all associated resources.
   */
  removeConnection(id: string): void {
    const managed = this.connections.get(id);
    if (!managed) {
      throw new Error(`Connection with id '${id}' not found`);
    }

    this.disconnectAndCleanup(managed);
    this.connections.delete(id);
  }

  /**
   * Update an existing PLC connection configuration.
   * Disconnects the current connection and reconnects with the new config.
   */
  updateConnection(config: S7ConnectionConfig): void {
    const managed = this.connections.get(config.id);
    if (!managed) {
      // Connection not yet tracked by the connector — just add it
      this.addConnection(config);
      return;
    }

    // Disconnect existing connection
    this.disconnectAndCleanup(managed);

    // Update config
    managed.config = config;

    // Reconnect if running and enabled
    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Add a variable mapping between a PLC address and an OPC UA node.
   * If the connection is active, the item will be added to the poll list immediately.
   */
  addMapping(mapping: S7Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    managed.mappings.set(mapping.id, mapping);

    // If connected, add the item to the nodes7 client
    if (managed.state === 'connected' && managed.client) {
      managed.client.addItems(mapping.plcAddress);
    }
  }

  /**
   * Remove a variable mapping. If the connection is active, the item
   * will be removed from the poll list.
   */
  removeMapping(id: string): void {
    for (const managed of this.connections.values()) {
      const mapping = managed.mappings.get(id);
      if (mapping) {
        managed.mappings.delete(id);
        // If connected, remove the item from the nodes7 client
        if (managed.state === 'connected' && managed.client) {
          managed.client.removeItems(mapping.plcAddress);
        }
        return;
      }
    }
    throw new Error(`Mapping with id '${id}' not found`);
  }

  /**
   * Get the current status of all managed connections.
   */
  getStatus(): S7ConnectionStatus[] {
    const statuses: S7ConnectionStatus[] = [];
    for (const managed of this.connections.values()) {
      const status: S7ConnectionStatus = {
        connectionId: managed.config.id,
        state: managed.state,
      };
      if (managed.lastPollAt) {
        status.lastPollAt = managed.lastPollAt.toISOString();
      }
      if (managed.errorMessage) {
        status.errorMessage = managed.errorMessage;
      }
      statuses.push(status);
    }
    return statuses;
  }

  /**
   * Start the S7 connector. Initiates connections to all enabled PLCs
   * and begins polling mapped variables.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    for (const managed of this.connections.values()) {
      if (managed.config.enabled) {
        this.initiateConnection(managed);
      }
    }
  }

  /**
   * Stop the S7 connector. Disconnects from all PLCs and stops polling.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const managed of this.connections.values()) {
      this.disconnectAndCleanup(managed);
    }
  }

  /**
   * Initiate a connection to a PLC using nodes7.
   */
  private initiateConnection(managed: ManagedConnection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    // Dynamically import nodes7 (CommonJS module)
    const NodeS7 = this.createNodeS7Instance();
    managed.client = NodeS7;

    const connectionParams = {
      host: managed.config.host,
      port: 102,
      rack: managed.config.rack,
      slot: managed.config.slot,
      timeout: 5000,
    };

    managed.client.initiateConnection(connectionParams, (err: any) => {
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
      const addresses = Array.from(managed.mappings.values()).map((m) => m.plcAddress);
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
   * Handle a connection error or disconnection event.
   * Sets affected node quality to "bad" and schedules reconnection.
   */
  private handleConnectionError(managed: ManagedConnection, err: any): void {
    const wasConnected = managed.state === 'connected';
    managed.state = wasConnected ? 'disconnected' : 'error';
    managed.errorMessage =
      typeof err === 'string' ? err : err?.message || 'Connection failed';

    this.log('error', managed.config.name, managed.errorMessage!);

    // Stop polling if it was active
    this.stopPolling(managed);

    // Set affected node quality to "bad"
    this.emitQualityUpdate(managed, 'bad');

    // Schedule reconnection if we're still running
    if (this.running) {
      this.scheduleReconnect(managed);
    }
  }

  /**
   * Start polling mapped variables at the configured interval.
   */
  private startPolling(managed: ManagedConnection): void {
    if (managed.pollingTimer) return;

    const poll = () => {
      if (managed.state !== 'connected' || !managed.client) return;
      if (managed.mappings.size === 0) return;

      managed.client.readAllItems((err: any, values: Record<string, any>) => {
        if (err) {
          // Read error indicates connection issue
          this.handleConnectionError(managed, err);
          return;
        }

        managed.lastPollAt = new Date();

        // Process the values and emit updates
        const updates: S7ValueUpdate[] = [];
        for (const mapping of managed.mappings.values()) {
          const value = values[mapping.plcAddress];
          if (value !== undefined) {
            updates.push({
              nodeId: mapping.nodeId,
              value: value,
              quality: 'good',
              timestamp: new Date(),
            });
          }
        }

        if (updates.length > 0) {
          const valuesSummary = updates.map((u) => {
            const mapping = Array.from(managed.mappings.values()).find((m) => m.nodeId === u.nodeId);
            const addr = mapping?.plcAddress ?? u.nodeId;
            return `${addr}=${JSON.stringify(u.value)}`;
          }).join(', ');
          this.log('debug', managed.config.name, `Read ${updates.length} var(s): ${valuesSummary}`);
          if (this.valueUpdateCallback) {
            this.valueUpdateCallback(updates);
          }
        }
      });
    };

    // Perform initial poll
    poll();

    // Set up interval polling
    managed.pollingTimer = setInterval(poll, managed.config.pollingIntervalMs);
  }

  /**
   * Stop the polling timer for a connection.
   */
  private stopPolling(managed: ManagedConnection): void {
    if (managed.pollingTimer) {
      clearInterval(managed.pollingTimer);
      managed.pollingTimer = null;
    }
  }

  /**
   * Schedule a reconnection attempt after the configured interval.
   */
  private scheduleReconnect(managed: ManagedConnection): void {
    // Clear any existing reconnect timer
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    this.log('warn', managed.config.name, `Reconnecting in ${managed.config.reconnectIntervalMs}ms...`);

    managed.reconnectTimer = setTimeout(() => {
      managed.reconnectTimer = null;

      if (!this.running) return;

      // Clean up old client before reconnecting
      if (managed.client) {
        try {
          managed.client.dropConnection(() => {});
        } catch {
          // Ignore cleanup errors
        }
        managed.client = null;
      }

      managed.state = 'disconnected';
      this.initiateConnection(managed);
    }, managed.config.reconnectIntervalMs);
  }

  /**
   * Emit quality updates for all nodes mapped to a connection.
   * Used when connection state changes (connected → good, disconnected → bad).
   */
  private emitQualityUpdate(managed: ManagedConnection, quality: 'good' | 'bad'): void {
    if (!this.valueUpdateCallback) return;
    if (managed.mappings.size === 0) return;

    const updates: S7ValueUpdate[] = [];
    for (const mapping of managed.mappings.values()) {
      updates.push({
        nodeId: mapping.nodeId,
        value: undefined,
        quality,
        timestamp: new Date(),
      });
    }

    this.valueUpdateCallback(updates);
  }

  /**
   * Disconnect from a PLC and clean up all timers and resources.
   */
  private disconnectAndCleanup(managed: ManagedConnection): void {
    this.stopPolling(managed);

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    if (managed.client) {
      try {
        managed.client.dropConnection(() => {});
      } catch {
        // Ignore cleanup errors during shutdown
      }
      managed.client = null;
    }

    managed.state = 'disconnected';
    managed.connecting = false;
    managed.errorMessage = undefined;
  }

  /**
   * Create a new nodes7 instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createNodeS7Instance(): any {
    return new NodeS7({ silent: true });
  }
}

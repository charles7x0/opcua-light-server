import { PLC } from 'ethernet-ip';
import type { PLCConnectOptions, TagValue } from 'ethernet-ip';
import type {
  Connector,
  ConnectorType,
  ConnectionConfig,
  ConnectionStatus,
  CurrentValue,
  Mapping,
  ValueUpdate,
  ValueUpdateCallback,
} from '../types.js';
import { logService } from '../../log/index.js';

/**
 * Represents a single managed EtherNet/IP connection with its polling state.
 */
interface ManagedConnection {
  config: ConnectionConfig;
  host: string;
  port: number;
  slot: number;
  plc: PLC | null;
  state: ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, Mapping>;
  connecting: boolean;
}

/**
 * EthernetIPConnector manages connections to Rockwell EtherNet/IP devices,
 * polls CIP tags at configured intervals, and communicates value updates
 * to the runtime.
 *
 * Implements the Connector interface for use within the multi-protocol
 * connector architecture. Maintains automatic reconnection on failure.
 * On connection loss, affected node quality is set to "bad".
 * On reconnection, polling resumes and node quality is restored to "good".
 */
export class EthernetIPConnector implements Connector {
  private connections: Map<string, ManagedConnection> = new Map();
  private running = false;
  private valueUpdateCallback: ValueUpdateCallback | null = null;
  /** In-memory cache of the last-read value per mapping ID. */
  private currentValues: Map<string, CurrentValue> = new Map();

  /** Returns the protocol type identifier. */
  getType(): ConnectorType {
    return 'ethernet-ip';
  }

  /**
   * Register a callback to receive value updates from EtherNet/IP polling.
   * The callback is invoked with batched updates after each poll cycle.
   */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }

  /**
   * Add a new EtherNet/IP connection configuration.
   * Extracts host, port, slot from config.params.
   * If the connector is already running, the connection will be initiated immediately.
   */
  addConnection(config: ConnectionConfig): void {
    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id '${config.id}' already exists`);
    }

    const { host, port, slot } = this.extractParams(config);

    const managed: ManagedConnection = {
      config,
      host,
      port,
      slot,
      plc: null,
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
   * Remove an EtherNet/IP connection and clean up all associated resources.
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
   * Update an existing EtherNet/IP connection configuration.
   * Disconnects the current connection and reconnects with the new config.
   */
  updateConnection(config: ConnectionConfig): void {
    const managed = this.connections.get(config.id);
    if (!managed) {
      this.addConnection(config);
      return;
    }

    this.disconnectAndCleanup(managed);

    const { host, port, slot } = this.extractParams(config);
    managed.config = config;
    managed.host = host;
    managed.port = port;
    managed.slot = slot;

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Add a variable mapping between a CIP tag name and an OPC UA node.
   */
  addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    managed.mappings.set(mapping.id, mapping);
  }

  /**
   * Remove a variable mapping.
   */
  removeMapping(id: string): void {
    for (const managed of this.connections.values()) {
      const mapping = managed.mappings.get(id);
      if (mapping) {
        managed.mappings.delete(id);
        this.currentValues.delete(id);
        return;
      }
    }
    throw new Error(`Mapping with id '${id}' not found`);
  }

  /**
   * Get the last-read values for all mapped variables across all connections.
   */
  getCurrentValues(): CurrentValue[] {
    return Array.from(this.currentValues.values());
  }

  /**
   * Get the current status of all managed connections.
   */
  getStatus(): ConnectionStatus[] {
    const statuses: ConnectionStatus[] = [];
    for (const managed of this.connections.values()) {
      const status: ConnectionStatus = {
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
   * Start the EtherNet/IP connector. Initiates connections to all enabled devices
   * and begins polling CIP tags.
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
   * Stop the EtherNet/IP connector. Disconnects from all devices and stops polling.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const managed of this.connections.values()) {
      this.disconnectAndCleanup(managed);
    }
  }

  /**
   * Extract EtherNet/IP-specific params (host, port, slot) from the generic ConnectionConfig.
   */
  private extractParams(config: ConnectionConfig): { host: string; port: number; slot: number } {
    const params = config.params;
    const host = params.host as string;
    const port = (params.port as number) ?? 44818;
    const slot = (params.slot as number) ?? 0;

    if (!host) {
      throw new Error(`EtherNet/IP connection '${config.name}' requires a 'host' parameter`);
    }

    return { host, port, slot };
  }

  /**
   * Initiate a connection to an EtherNet/IP device.
   */
  private initiateConnection(managed: ManagedConnection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    const plc = this.createPLC();
    managed.plc = plc;

    this.log('info', managed.config.name, `Connecting to ${managed.host}:${managed.port} slot ${managed.slot}...`);

    const connectOptions: PLCConnectOptions = {
      slot: managed.slot,
      autoReconnect: false,
    };

    plc.connect(managed.host, connectOptions)
      .then(() => {
        managed.connecting = false;

        // Guard: plc may have been nullified by disconnectAndCleanup
        if (!managed.plc) {
          this.log('warn', managed.config.name, 'Connection succeeded but PLC was already cleaned up — ignoring');
          return;
        }

        managed.state = 'connected';
        managed.errorMessage = undefined;

        this.log('info', managed.config.name, 'Connected successfully');

        // Notify that nodes are now good quality
        this.emitQualityUpdate(managed, 'good');

        // Start polling
        this.startPolling(managed);
      })
      .catch((err: unknown) => {
        managed.connecting = false;
        this.handleConnectionError(managed, err);
      });
  }

  /**
   * Handle a connection error or disconnection event.
   * Sets affected node quality to "bad" and schedules reconnection.
   */
  private handleConnectionError(managed: ManagedConnection, err: unknown): void {
    const wasConnected = managed.state === 'connected';
    managed.state = wasConnected ? 'disconnected' : 'error';
    managed.errorMessage =
      typeof err === 'string' ? err : (err as Error)?.message || 'Connection failed';

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
   * Start polling CIP tags at the configured interval.
   */
  private startPolling(managed: ManagedConnection): void {
    if (managed.pollingTimer) return;

    const poll = (): void => {
      if (managed.state !== 'connected' || !managed.plc) return;
      if (managed.mappings.size === 0) return;

      this.pollTags(managed);
    };

    // Perform initial poll
    poll();

    // Set up interval polling
    managed.pollingTimer = setInterval(poll, managed.config.pollingIntervalMs);
  }

  /**
   * Poll all mapped CIP tags for a connection.
   * Reads each tag individually using the PLC.read() method.
   */
  private pollTags(managed: ManagedConnection): void {
    if (!managed.plc) return;

    const mappings = Array.from(managed.mappings.values());
    const tagNames = mappings.map((m) => m.deviceAddress);

    // Use batch read when multiple tags exist
    const readPromise = tagNames.length === 1
      ? managed.plc.read(tagNames[0]).then((val) => [val])
      : managed.plc.read(tagNames);

    readPromise
      .then((values: TagValue[]) => {
        managed.lastPollAt = new Date();

        const updates: ValueUpdate[] = [];
        for (let i = 0; i < mappings.length; i++) {
          const mapping = mappings[i];
          const value = values[i];
          if (value !== undefined) {
            const now = new Date();
            updates.push({
              nodeId: mapping.nodeId,
              value: this.normalizeTagValue(value),
              quality: 'good',
              timestamp: now,
            });
            this.currentValues.set(mapping.id, {
              nodeId: mapping.nodeId,
              deviceAddress: mapping.deviceAddress,
              connectionId: managed.config.id,
              value: this.normalizeTagValue(value),
              quality: 'good',
              timestamp: now.toISOString(),
            });
          }
        }

        if (updates.length > 0) {
          const valuesSummary = updates.map((u) => {
            const mapping = mappings.find((m) => m.nodeId === u.nodeId);
            const addr = mapping?.deviceAddress ?? u.nodeId;
            return `${addr}=${JSON.stringify(u.value)}`;
          }).join(', ');
          this.log('debug', managed.config.name, `Read ${updates.length} tag(s): ${valuesSummary}`);
          if (this.valueUpdateCallback) {
            this.valueUpdateCallback(updates);
          }
        }
      })
      .catch((err: unknown) => {
        this.handleConnectionError(managed, err);
      });
  }

  /**
   * Normalize a TagValue to a JSON-safe value for OPC UA.
   * Converts bigint to number and Buffer to array.
   */
  private normalizeTagValue(value: TagValue): unknown {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (Buffer.isBuffer(value)) {
      return Array.from(value);
    }
    return value;
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
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    this.log('warn', managed.config.name, `Reconnecting in ${managed.config.reconnectIntervalMs}ms...`);

    managed.reconnectTimer = setTimeout(() => {
      managed.reconnectTimer = null;

      if (!this.running) return;

      // Clean up old PLC before reconnecting
      if (managed.plc) {
        managed.plc.disconnect().catch(() => {});
        managed.plc = null;
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
    // Update cached values quality
    for (const mapping of managed.mappings.values()) {
      const cached = this.currentValues.get(mapping.id);
      if (cached) {
        cached.quality = quality;
        cached.timestamp = new Date().toISOString();
      } else if (quality === 'bad') {
        this.currentValues.set(mapping.id, {
          nodeId: mapping.nodeId,
          deviceAddress: mapping.deviceAddress,
          connectionId: managed.config.id,
          value: undefined,
          quality: 'bad',
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (!this.valueUpdateCallback) return;
    if (managed.mappings.size === 0) return;

    const updates: ValueUpdate[] = [];
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
   * Disconnect from an EtherNet/IP device and clean up all timers and resources.
   */
  private disconnectAndCleanup(managed: ManagedConnection): void {
    this.stopPolling(managed);

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    if (managed.plc) {
      managed.plc.disconnect().catch(() => {});
      managed.plc = null;
    }

    managed.state = 'disconnected';
    managed.connecting = false;
    managed.errorMessage = undefined;
  }

  /**
   * Create a new ethernet-ip PLC instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createPLC(): PLC {
    return new PLC();
  }

  /**
   * Log a message to the central log service.
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', connectionName: string, message: string): void {
    logService.log(level, `EthernetIP:${connectionName}`, message);
  }
}

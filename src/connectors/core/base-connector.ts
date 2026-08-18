import type {
  ConnectorPlugin,
  ConnectorMetadata,
  ConnectorType,
  ConnectionConfig,
  ConnectionStatus,
  CurrentValue,
  Mapping,
  ValueUpdate,
  ValueUpdateCallback,
} from './types.js';
import { logService } from '../../log/index.js';

/**
 * Base interface for a managed connection. Protocol-specific connectors
 * extend this with their own client type and extra fields.
 */
export interface BaseManagedConnection<TClient> {
  config: ConnectionConfig;
  client: TClient | null;
  state: ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, Mapping>;
  connecting: boolean;
}

/**
 * Abstract base class for all protocol connectors.
 * Implements all the duplicated boilerplate (connection lifecycle, polling timers,
 * reconnection scheduling, quality updates, value caching) so subclasses only
 * need to provide protocol-specific logic.
 *
 * @typeParam TClient - The protocol-specific client type (e.g., NodeS7, ModbusRTU, PLC)
 * @typeParam TManaged - The protocol-specific managed connection interface
 */
export abstract class BaseConnector<TClient, TManaged extends BaseManagedConnection<TClient>>
  implements ConnectorPlugin
{
  protected connections: Map<string, TManaged> = new Map();
  protected running = false;
  protected valueUpdateCallback: ValueUpdateCallback | null = null;
  /** In-memory cache of the last-read value per mapping ID. */
  protected currentValues: Map<string, CurrentValue> = new Map();

  // ─── Abstract methods (subclasses must implement) ───────────────────────

  /** Returns the protocol type identifier (e.g., 's7', 'modbus-tcp'). */
  abstract getType(): ConnectorType;

  /** Returns the metadata descriptor for this connector's protocol. */
  abstract getMetadata(): ConnectorMetadata;

  /**
   * Extract protocol-specific params from the generic ConnectionConfig.
   * Should throw if required params are missing.
   */
  protected abstract extractParams(config: ConnectionConfig): Record<string, unknown>;

  /**
   * Create a new managed connection object with protocol-specific fields.
   */
  protected abstract createManagedConnection(config: ConnectionConfig, params: Record<string, unknown>): TManaged;

  /**
   * Initiate a connection to the device using the protocol-specific client.
   * Should set `managed.connecting = true` at start, create a client,
   * and on success call `this.onConnectionSuccess(managed)`.
   * On failure call `this.handleConnectionError(managed, err)`.
   */
  abstract initiateConnection(managed: TManaged): void;

  /**
   * Start polling mapped variables at the configured interval.
   * Protocol-specific because each protocol reads differently.
   */
  abstract startPolling(managed: TManaged): void;

  /**
   * Close the protocol-specific client connection.
   * Should handle errors silently (best-effort cleanup).
   */
  abstract closeClient(managed: TManaged): void;

  // ─── Implemented methods (shared across all connectors) ─────────────────

  /**
   * Register a callback to receive value updates from polling.
   */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }

  /**
   * Add a new connection configuration.
   * If the connector is already running and the connection is enabled,
   * it will be initiated immediately.
   */
  addConnection(config: ConnectionConfig): void {
    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id '${config.id}' already exists`);
    }

    const params = this.extractParams(config);
    const managed = this.createManagedConnection(config, params);

    this.connections.set(config.id, managed);

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Remove a connection and clean up all associated resources.
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
   * Update an existing connection configuration.
   * Disconnects the current connection and reconnects with the new config.
   * If the id is not found, adds it as a new connection.
   */
  updateConnection(config: ConnectionConfig): void {
    const managed = this.connections.get(config.id);
    if (!managed) {
      this.addConnection(config);
      return;
    }

    this.disconnectAndCleanup(managed);

    const params = this.extractParams(config);
    managed.config = config;
    this.applyParams(managed, params);

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Add a variable mapping. Base implementation stores the mapping.
   * Subclasses can override to add protocol-specific registration (e.g., addItems).
   */
  addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    managed.mappings.set(mapping.id, mapping);
  }

  /**
   * Remove a variable mapping. Iterates all connections looking for the mapping.
   * Subclasses can override to add protocol-specific unregistration (e.g., removeItems).
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
   * Start the connector. Initiates connections to all enabled devices
   * and begins polling.
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
   * Stop the connector. Disconnects from all devices and stops polling.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const managed of this.connections.values()) {
      this.disconnectAndCleanup(managed);
    }
  }

  // ─── Protected helpers for subclasses ───────────────────────────────────

  /**
   * Handle a connection error or disconnection event.
   * Sets affected node quality to "bad" and schedules reconnection.
   */
  protected handleConnectionError(managed: TManaged, err: unknown): void {
    const wasConnected = managed.state === 'connected';
    managed.state = wasConnected ? 'disconnected' : 'error';
    managed.errorMessage =
      typeof err === 'string' ? err : (err as Error)?.message || 'Connection failed';

    this.log('error', managed.config.name, managed.errorMessage!);

    this.stopPolling(managed);
    this.emitQualityUpdate(managed, 'bad');

    if (this.running) {
      this.scheduleReconnect(managed);
    }
  }

  /**
   * Stop the polling timer for a connection.
   */
  protected stopPolling(managed: TManaged): void {
    if (managed.pollingTimer) {
      clearInterval(managed.pollingTimer);
      managed.pollingTimer = null;
    }
  }

  /**
   * Schedule a reconnection attempt after the configured interval.
   */
  protected scheduleReconnect(managed: TManaged): void {
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    this.log('warn', managed.config.name, `Reconnecting in ${managed.config.reconnectIntervalMs}ms...`);

    managed.reconnectTimer = setTimeout(() => {
      managed.reconnectTimer = null;

      if (!this.running) return;

      this.closeClient(managed);
      managed.client = null;
      managed.state = 'disconnected';
      this.initiateConnection(managed);
    }, managed.config.reconnectIntervalMs);
  }

  /**
   * Emit quality updates for all nodes mapped to a connection.
   * Updates the cache and emits ValueUpdate[] via the callback.
   */
  protected emitQualityUpdate(managed: TManaged, quality: 'good' | 'bad'): void {
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
      if (!mapping.nodeId) continue;
      updates.push({
        nodeId: mapping.nodeId,
        value: undefined,
        quality,
        timestamp: new Date(),
      });
    }

    if (updates.length > 0) {
      this.valueUpdateCallback(updates);
    }
  }

  /**
   * Disconnect from a device and clean up all timers and resources.
   */
  protected disconnectAndCleanup(managed: TManaged): void {
    this.stopPolling(managed);

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    this.closeClient(managed);
    managed.client = null;
    managed.state = 'disconnected';
    managed.connecting = false;
    managed.errorMessage = undefined;
  }

  /**
   * Log a message to the central log service.
   * Uses the connector's log prefix (derived from the type).
   */
  protected log(level: 'info' | 'warn' | 'error' | 'debug', connectionName: string, message: string): void {
    logService.log(level, `${this.getLogPrefix()}:${connectionName}`, message);
  }

  /**
   * Emit value updates via the registered callback (if set).
   */
  protected emitValueUpdates(updates: ValueUpdate[]): void {
    if (this.valueUpdateCallback && updates.length > 0) {
      this.valueUpdateCallback(updates);
    }
  }

  /**
   * Cache a value for the live values API.
   */
  protected cacheValue(mappingId: string, value: CurrentValue): void {
    this.currentValues.set(mappingId, value);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  /**
   * Get the log prefix for this connector type.
   * Subclasses can override for a custom prefix.
   */
  protected getLogPrefix(): string {
    const type = this.getType();
    // Convert type to title case for log prefix
    switch (type) {
      case 's7': return 'S7';
      case 'modbus-tcp': return 'Modbus';
      case 'ethernet-ip': return 'EthernetIP';
      case 'pccc': return 'PCCC';
      default: return type;
    }
  }

  /**
   * Apply extracted params to the managed connection.
   * Subclasses must implement to set protocol-specific fields.
   */
  protected abstract applyParams(managed: TManaged, params: Record<string, unknown>): void;
}

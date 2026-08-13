import NodePCCC from 'nodepccc';
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
} from '../types.js';
import { logService } from '../../log/index.js';

/**
 * Connection parameters extracted from a PCCC ConnectionConfig.
 */
interface PcccParams {
  host: string;
  port: number;
  slot: number;
  routing?: number[];
}

/**
 * Represents a single managed PCCC connection with its polling state.
 */
interface ManagedPcccConnection {
  config: ConnectionConfig;
  host: string;
  port: number;
  slot: number;
  routing: number[] | undefined;
  plc: NodePCCC | null;
  state: ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pollInProgress: boolean;
  mappings: Map<string, Mapping>;
  connecting: boolean;
}

/**
 * PcccConnector manages connections to Allen-Bradley legacy PLCs
 * (SLC 500, MicroLogix, PLC-5) using PCCC messages encapsulated over
 * EtherNet/IP via the nodepccc library.
 *
 * Implements the Connector interface for use within the multi-protocol
 * connector architecture. Maintains automatic reconnection on failure.
 * On connection loss, affected node quality is set to "bad".
 * On reconnection, polling resumes and node quality is restored to "good".
 */
export class PcccConnector implements ConnectorPlugin {
  /** Regex for validating PCCC file-based addresses. */
  private static readonly PCCC_ADDRESS_REGEX = /^([A-Z]{1,2})(\d+)?:(\d+)(\/(\d+|DN|EN|TT|ACC|PRE|LEN|POS|CU|CD|OV|UN|UA))?(\.\w+)?(,\d+)?$/i;

  private connections: Map<string, ManagedPcccConnection> = new Map();
  private running = false;
  private valueUpdateCallback: ValueUpdateCallback | null = null;
  /** In-memory cache of the last-read value per mapping ID. */
  private currentValues: Map<string, CurrentValue> = new Map();

  /** Returns the protocol type identifier. */
  getType(): ConnectorType {
    return 'pccc';
  }

  /** Returns the metadata descriptor for the PCCC protocol. */
  getMetadata(): ConnectorMetadata {
    return {
      type: 'pccc',
      displayName: 'PCCC',
      paramsSchema: [
        { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '192.168.1.10' },
        { key: 'port', label: 'Port', type: 'number', required: false, defaultValue: 44818, min: 1, max: 65535 },
        { key: 'slot', label: 'Slot', type: 'number', required: false, defaultValue: 0, min: 0 },
      ],
    };
  }

  /**
   * Register a callback to receive value updates from PCCC polling.
   * The callback is invoked with batched updates after each poll cycle.
   */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }

  /**
   * Extract PCCC-specific params (host, port, slot, routing) from the generic ConnectionConfig.
   */
  private extractParams(config: ConnectionConfig): PcccParams {
    const params = config.params;
    const host = params.host as string;
    const port = (params.port as number) ?? 44818;
    const slot = (params.slot as number) ?? 0;
    const routing = params.routing as number[] | undefined;

    if (!host) {
      throw new Error(`PCCC connection '${config.name}' requires a 'host' parameter`);
    }

    return { host, port, slot, routing };
  }

  /**
   * Create a new nodepccc instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createPLC(): NodePCCC {
    return new NodePCCC();
  }

  /**
   * Start the PCCC connector. Initiates connections to all enabled devices
   * and begins polling. Idempotent — calling multiple times has no additional effect.
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
   * Stop the PCCC connector. Disconnects from all devices and stops polling.
   * Idempotent — calling multiple times has no additional effect.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const managed of this.connections.values()) {
      this.disconnectAndCleanup(managed);
    }
  }

  /**
   * Add a new PCCC connection configuration.
   * Validates parameters, creates a ManagedPcccConnection, stores it,
   * and initiates the connection if the connector is running and the connection is enabled.
   */
  addConnection(config: ConnectionConfig): void {
    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id '${config.id}' already exists`);
    }

    const { host, port, slot, routing } = this.extractParams(config);

    const managed: ManagedPcccConnection = {
      config,
      host,
      port,
      slot,
      routing,
      plc: null,
      state: 'disconnected',
      pollingTimer: null,
      reconnectTimer: null,
      pollInProgress: false,
      mappings: new Map(),
      connecting: false,
    };

    this.connections.set(config.id, managed);

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Remove a PCCC connection and clean up all associated resources.
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
   * Update an existing PCCC connection configuration.
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

    const { host, port, slot, routing } = this.extractParams(config);
    managed.config = config;
    managed.host = host;
    managed.port = port;
    managed.slot = slot;
    managed.routing = routing;

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Add a variable mapping between a PCCC file address and an OPC UA node.
   * Validates the connection exists and the address format before registering.
   */
  addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    // Validate PCCC file-based address format
    if (!PcccConnector.PCCC_ADDRESS_REGEX.test(mapping.deviceAddress)) {
      throw new Error(
        `Invalid PCCC address '${mapping.deviceAddress}'. Expected format: <FileType><FileNumber>:<Element>[/<Bit>][.SubElement][,ArrayLength] (e.g., N7:0, F8:1, B3:0/5, T4:0.ACC)`
      );
    }

    managed.mappings.set(mapping.id, mapping);

    // Register the address with nodepccc if PLC is connected
    if (managed.plc) {
      managed.plc.addItems(mapping.deviceAddress);
    }
  }

  /**
   * Remove a variable mapping. Unregisters from nodepccc and removes from cache.
   */
  removeMapping(id: string): void {
    for (const managed of this.connections.values()) {
      const mapping = managed.mappings.get(id);
      if (mapping) {
        // Unregister from nodepccc if PLC is connected
        if (managed.plc) {
          managed.plc.removeItems(mapping.deviceAddress);
        }
        managed.mappings.delete(id);
        this.currentValues.delete(id);
        return;
      }
    }
    throw new Error(`Mapping with id '${id}' not found`);
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
   * Get the last-read values for all mapped variables across all connections.
   */
  getCurrentValues(): CurrentValue[] {
    return Array.from(this.currentValues.values());
  }

  /**
   * Initiate a connection to the PLC using nodepccc.
   * Guards against duplicate connection attempts via the `connecting` flag.
   */
  private initiateConnection(managed: ManagedPcccConnection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    const plc = this.createPLC();
    managed.plc = plc;

    this.log('info', managed.config.name, `Connecting to ${managed.host}:${managed.port}...`);

    // Set pass-through translation so nodepccc uses absolute PCCC addresses directly
    plc.setTranslationCB((tag: string) => tag);

    plc.initiateConnection(
      { host: managed.host, port: managed.port, routing: managed.routing },
      (err: unknown) => {
        managed.connecting = false;

        // Guard: plc may have been nullified by disconnectAndCleanup
        if (!managed.plc) {
          this.log('warn', managed.config.name, 'Connection callback fired but PLC was already cleaned up — ignoring');
          return;
        }

        if (err) {
          this.handleConnectionError(managed, err);
        } else {
          managed.state = 'connected';
          managed.errorMessage = undefined;
          this.log('info', managed.config.name, 'Connected successfully');
          this.emitQualityUpdate(managed, 'good');
          this.startPolling(managed);
        }
      }
    );
  }

  /**
   * Handle a connection error or disconnection event.
   * Sets affected node quality to "bad" and schedules reconnection.
   */
  private handleConnectionError(managed: ManagedPcccConnection, err: unknown): void {
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
   * Start polling mapped addresses at the configured interval.
   * Performs an initial poll immediately, then sets up periodic polling.
   */
  private startPolling(managed: ManagedPcccConnection): void {
    if (managed.pollingTimer) return;

    const poll = (): void => {
      if (managed.state !== 'connected' || !managed.plc) return;
      if (managed.mappings.size === 0) return;
      if (managed.pollInProgress) return;

      this.pollAddresses(managed);
    };

    // Perform initial poll
    poll();

    // Set up interval polling
    managed.pollingTimer = setInterval(poll, managed.config.pollingIntervalMs);
  }

  /**
   * Poll all registered PCCC addresses for a connection.
   * Reads all items via nodepccc, caches values for all mappings,
   * and emits updates only for mappings with a non-null nodeId.
   */
  private pollAddresses(managed: ManagedPcccConnection): void {
    if (!managed.plc) return;

    managed.pollInProgress = true;

    managed.plc.readAllItems((anythingBad: boolean) => {
      managed.pollInProgress = false;

      // Guard: plc may have been cleaned up during read
      if (!managed.plc) return;

      const mappings = Array.from(managed.mappings.values());

      if (anythingBad) {
        // Check if ALL items are bad (connection loss) or just some (partial bad)
        let allBad = true;
        for (const mapping of mappings) {
          const item = managed.plc!.findItem(mapping.deviceAddress);
          if (item && item.quality === 'OK') {
            allBad = false;
            break;
          }
        }

        if (allBad) {
          // All items bad — treat as connection loss
          this.handleConnectionError(managed, 'All items returned bad quality');
          return;
        }
      }

      // Process individual items
      managed.lastPollAt = new Date();
      const updates: ValueUpdate[] = [];

      for (const mapping of mappings) {
        const item = managed.plc!.findItem(mapping.deviceAddress);
        if (!item) continue;

        const now = new Date();
        const quality = item.quality === 'OK' ? 'good' : 'bad';

        // Always cache regardless of nodeId
        this.currentValues.set(mapping.id, {
          nodeId: mapping.nodeId,
          deviceAddress: mapping.deviceAddress,
          connectionId: managed.config.id,
          value: item.value,
          quality,
          timestamp: now.toISOString(),
        });

        // Only emit to runtime if mapping has a nodeId
        if (mapping.nodeId) {
          updates.push({
            nodeId: mapping.nodeId,
            value: item.value,
            quality,
            timestamp: now,
          });
        }
      }

      if (updates.length > 0 && this.valueUpdateCallback) {
        this.valueUpdateCallback(updates);
      }
    });
  }

  /**
   * Schedule a reconnection attempt after the configured interval.
   * Clears any existing timer, then waits reconnectIntervalMs before
   * dropping the old PLC and calling initiateConnection() with a fresh instance.
   */
  private scheduleReconnect(managed: ManagedPcccConnection): void {
    // Clear any existing reconnect timer
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    this.log('warn', managed.config.name, `Reconnecting in ${managed.config.reconnectIntervalMs}ms...`);

    managed.reconnectTimer = setTimeout(() => {
      managed.reconnectTimer = null;

      // Guard: skip if connector was stopped
      if (!this.running) return;

      // Guard: skip if already connecting
      if (managed.connecting) return;

      // Clean up old PLC before reconnecting
      if (managed.plc) {
        managed.plc.dropConnection();
        managed.plc = null;
      }

      managed.state = 'disconnected';
      this.initiateConnection(managed);
    }, managed.config.reconnectIntervalMs);
  }

  /**
   * Emit a quality update for all mappings associated with a connection.
   * Updates cached values quality and emits ValueUpdate for all mappings with non-null nodeId.
   */
  private emitQualityUpdate(managed: ManagedPcccConnection, quality: 'good' | 'bad'): void {
    // Update cached values quality
    for (const mapping of managed.mappings.values()) {
      const cached = this.currentValues.get(mapping.id);
      if (cached) {
        cached.quality = quality;
        cached.timestamp = new Date().toISOString();
      } else if (quality === 'bad') {
        // Create a cache entry for mappings that haven't been polled yet
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
   * Stop polling for a managed connection by clearing the interval timer.
   */
  private stopPolling(managed: ManagedPcccConnection): void {
    if (managed.pollingTimer) {
      clearInterval(managed.pollingTimer);
      managed.pollingTimer = null;
    }
  }

  /**
   * Disconnect a managed connection, clear all timers, and reset state.
   */
  private disconnectAndCleanup(managed: ManagedPcccConnection): void {
    this.stopPolling(managed);
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }
    if (managed.plc) {
      managed.plc.dropConnection();
      managed.plc = null;
    }
    managed.state = 'disconnected';
    managed.connecting = false;
    managed.errorMessage = undefined;
  }

  /**
   * Log a message to the central log service.
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', connectionName: string, message: string): void {
    logService.log(level, `PCCC:${connectionName}`, message);
  }
}

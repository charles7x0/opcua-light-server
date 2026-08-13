import ModbusRTU from 'modbus-serial';
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

/** Type alias for a modbus-serial client instance. */
type ModbusClient = InstanceType<typeof ModbusRTU>;

/**
 * Parsed Modbus device address.
 * Supported formats:
 * - "HR:address:count" — Holding Registers (FC3)
 * - "IR:address:count" — Input Registers (FC4)
 * - "CO:address"       — Coils (FC1)
 * - "DI:address"       — Discrete Inputs (FC2)
 */
interface ParsedAddress {
  type: 'HR' | 'IR' | 'CO' | 'DI';
  address: number;
  count: number;
}

/**
 * Represents a single managed Modbus TCP connection with its polling state.
 */
interface ManagedConnection {
  config: ConnectionConfig;
  host: string;
  port: number;
  unitId: number;
  client: ModbusClient | null;
  state: ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, Mapping>;
  connecting: boolean;
}

/** Maximum number of log entries to keep in memory. */
const MAX_LOG_ENTRIES = 1000;

/**
 * A log entry from the Modbus connector.
 */
export interface ModbusLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  connectionName: string;
  message: string;
}

/**
 * ModbusConnector manages connections to Modbus TCP devices, polls mapped variables
 * at configured intervals, and communicates value updates to the runtime.
 *
 * Implements the Connector interface for use within the multi-protocol
 * connector architecture. Maintains automatic reconnection on failure.
 * On connection loss, affected node quality is set to "bad".
 * On reconnection, polling resumes and node quality is restored to "good".
 */
export class ModbusConnector implements ConnectorPlugin {
  private connections: Map<string, ManagedConnection> = new Map();
  private running = false;
  private valueUpdateCallback: ValueUpdateCallback | null = null;
  private logEntries: ModbusLogEntry[] = [];
  /** In-memory cache of the last-read value per mapping ID. */
  private currentValues: Map<string, CurrentValue> = new Map();

  /** Returns the protocol type identifier. */
  getType(): ConnectorType {
    return 'modbus-tcp';
  }

  /** Returns the metadata descriptor for the Modbus TCP protocol. */
  getMetadata(): ConnectorMetadata {
    return {
      type: 'modbus-tcp',
      displayName: 'Modbus TCP',
      paramsSchema: [
        {
          key: 'host',
          label: 'Host',
          type: 'text',
          required: true,
          placeholder: '192.168.1.10',
        },
        {
          key: 'port',
          label: 'Port',
          type: 'number',
          required: true,
          defaultValue: 502,
          min: 1,
          max: 65535,
        },
        {
          key: 'unitId',
          label: 'Unit ID',
          type: 'number',
          required: true,
          defaultValue: 1,
          min: 0,
          max: 255,
        },
      ],
    };
  }

  /**
   * Register a callback to receive value updates from Modbus polling.
   * The callback is invoked with batched updates after each poll cycle.
   */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }

  /**
   * Get the log entries (most recent last).
   * Optionally filter by a "since" timestamp to get only new entries.
   */
  getLogs(since?: string): ModbusLogEntry[] {
    if (!since) return [...this.logEntries];
    return this.logEntries.filter((e) => e.timestamp > since);
  }

  /**
   * Add a log entry to the ring buffer and the central log service.
   */
  private log(level: ModbusLogEntry['level'], connectionName: string, message: string): void {
    const entry: ModbusLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      connectionName,
      message,
    };
    this.logEntries.push(entry);
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries.shift();
    }
    logService.log(level, `Modbus:${connectionName}`, message);
  }

  /**
   * Add a new Modbus TCP connection configuration.
   * Extracts host, port, unitId from config.params.
   * If the connector is already running, the connection will be initiated immediately.
   */
  addConnection(config: ConnectionConfig): void {
    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id '${config.id}' already exists`);
    }

    const { host, port, unitId } = this.extractParams(config);

    const managed: ManagedConnection = {
      config,
      host,
      port,
      unitId,
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
   * Remove a Modbus TCP connection and clean up all associated resources.
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
   * Update an existing Modbus TCP connection configuration.
   * Disconnects the current connection and reconnects with the new config.
   */
  updateConnection(config: ConnectionConfig): void {
    const managed = this.connections.get(config.id);
    if (!managed) {
      this.addConnection(config);
      return;
    }

    this.disconnectAndCleanup(managed);

    const { host, port, unitId } = this.extractParams(config);
    managed.config = config;
    managed.host = host;
    managed.port = port;
    managed.unitId = unitId;

    if (this.running && config.enabled) {
      this.initiateConnection(managed);
    }
  }

  /**
   * Add a variable mapping between a device address and an OPC UA node.
   * The device address is validated on addition.
   */
  addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    // Validate the device address format
    this.parseDeviceAddress(mapping.deviceAddress);

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
   * Start the Modbus connector. Initiates connections to all enabled devices
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
   * Stop the Modbus connector. Disconnects from all devices and stops polling.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const managed of this.connections.values()) {
      this.disconnectAndCleanup(managed);
    }
  }

  /**
   * Extract Modbus-specific params (host, port, unitId) from the generic ConnectionConfig.
   */
  private extractParams(config: ConnectionConfig): { host: string; port: number; unitId: number } {
    const params = config.params;
    const host = params.host as string;
    const port = (params.port as number) ?? 502;
    const unitId = (params.unitId as number) ?? 1;

    if (!host) {
      throw new Error(`Modbus connection '${config.name}' requires a 'host' parameter`);
    }

    return { host, port, unitId };
  }

  /**
   * Parse a device address string into its components.
   * Supported formats:
   * - "HR:address:count" — Holding Registers
   * - "IR:address:count" — Input Registers
   * - "CO:address"       — Coils
   * - "DI:address"       — Discrete Inputs
   *
   * For HR and IR, count defaults to 1 if not specified.
   */
  parseDeviceAddress(address: string): ParsedAddress {
    const parts = address.split(':');
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(`Invalid Modbus device address format: '${address}'. Expected "TYPE:address[:count]"`);
    }

    const type = parts[0].toUpperCase();
    const addr = parseInt(parts[1], 10);

    if (isNaN(addr) || addr < 0) {
      throw new Error(`Invalid Modbus address number in '${address}': must be a non-negative integer`);
    }

    switch (type) {
      case 'HR':
      case 'IR': {
        const count = parts[2] ? parseInt(parts[2], 10) : 1;
        if (isNaN(count) || count < 1) {
          throw new Error(`Invalid register count in '${address}': must be a positive integer`);
        }
        return { type, address: addr, count };
      }
      case 'CO':
      case 'DI': {
        return { type, address: addr, count: 1 };
      }
      default:
        throw new Error(
          `Unknown Modbus register type '${type}' in address '${address}'. Expected HR, IR, CO, or DI`
        );
    }
  }

  /**
   * Initiate a connection to a Modbus TCP device.
   */
  private initiateConnection(managed: ManagedConnection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    const client = this.createModbusClient();
    managed.client = client;

    client.connectTCP(managed.host, { port: managed.port })
      .then(() => {
        managed.connecting = false;

        // Guard: client may have been nullified by disconnectAndCleanup during
        // the async connection handshake.
        if (!managed.client) {
          this.log('warn', managed.config.name, 'Connection succeeded but client was already cleaned up — ignoring');
          return;
        }

        managed.state = 'connected';
        managed.errorMessage = undefined;

        client.setID(managed.unitId);

        this.log('info', managed.config.name, `Connected to ${managed.host}:${managed.port} (unit ${managed.unitId})`);

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
   * Start polling mapped variables at the configured interval.
   */
  private startPolling(managed: ManagedConnection): void {
    if (managed.pollingTimer) return;

    const poll = async (): Promise<void> => {
      if (managed.state !== 'connected' || !managed.client) return;
      if (managed.mappings.size === 0) return;

      try {
        managed.client.setID(managed.unitId);

        const updates: ValueUpdate[] = [];

        for (const mapping of managed.mappings.values()) {
          try {
            const parsed = this.parseDeviceAddress(mapping.deviceAddress);
            const value = await this.readAddress(managed.client, parsed);
            const now = new Date();

            // Only emit to runtime if mapping has a nodeId
            if (mapping.nodeId) {
              updates.push({
                nodeId: mapping.nodeId,
                value,
                quality: 'good',
                timestamp: now,
              });
            }

            // Always cache for the live values API
            this.currentValues.set(mapping.id, {
              nodeId: mapping.nodeId,
              deviceAddress: mapping.deviceAddress,
              connectionId: managed.config.id,
              value,
              quality: 'good',
              timestamp: now.toISOString(),
            });
          } catch (readErr: unknown) {
            // Individual read failure — log but continue with other mappings
            const msg = (readErr as Error)?.message || 'Read failed';
            this.log('warn', managed.config.name, `Failed to read ${mapping.deviceAddress}: ${msg}`);

            // If it's a connection-level error, handle it and break
            if (this.isConnectionError(readErr)) {
              this.handleConnectionError(managed, readErr);
              return;
            }
          }
        }

        if (updates.length > 0) {
          managed.lastPollAt = new Date();

          const valuesSummary = updates.map((u) => {
            const mapping = Array.from(managed.mappings.values()).find((m) => m.nodeId === u.nodeId);
            const addr = mapping?.deviceAddress ?? u.nodeId;
            return `${addr}=${JSON.stringify(u.value)}`;
          }).join(', ');
          this.log('debug', managed.config.name, `Read ${updates.length} var(s): ${valuesSummary}`);

          if (this.valueUpdateCallback) {
            this.valueUpdateCallback(updates);
          }
        }
      } catch (err: unknown) {
        // General poll error — likely a connection issue
        this.handleConnectionError(managed, err);
      }
    };

    // Perform initial poll
    void poll();

    // Set up interval polling
    managed.pollingTimer = setInterval(() => void poll(), managed.config.pollingIntervalMs);
  }

  /**
   * Read a single Modbus address from the client.
   * Returns a number, number[], or boolean depending on the address type and count.
   */
  private async readAddress(client: ModbusClient, parsed: ParsedAddress): Promise<unknown> {
    switch (parsed.type) {
      case 'HR': {
        const result = await client.readHoldingRegisters(parsed.address, parsed.count);
        return parsed.count === 1 ? result.data[0] : result.data;
      }
      case 'IR': {
        const result = await client.readInputRegisters(parsed.address, parsed.count);
        return parsed.count === 1 ? result.data[0] : result.data;
      }
      case 'CO': {
        const result = await client.readCoils(parsed.address, 1);
        return result.data[0];
      }
      case 'DI': {
        const result = await client.readDiscreteInputs(parsed.address, 1);
        return result.data[0];
      }
    }
  }

  /**
   * Determine if an error indicates a connection-level failure.
   */
  private isConnectionError(err: unknown): boolean {
    if (!err) return false;
    const message = (err as Error)?.message?.toLowerCase() || '';
    return (
      message.includes('port not open') ||
      message.includes('timed out') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('ehostunreach') ||
      message.includes('enetunreach') ||
      message.includes('not connected')
    );
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

      // Clean up old client before reconnecting
      if (managed.client) {
        try {
          managed.client.close(() => {});
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
  private disconnectAndCleanup(managed: ManagedConnection): void {
    this.stopPolling(managed);

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    if (managed.client) {
      try {
        managed.client.close(() => {});
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
   * Create a new modbus-serial client instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createModbusClient(): ModbusClient {
    return new ModbusRTU();
  }
}

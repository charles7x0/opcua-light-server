import ModbusRTU from 'modbus-serial';
import type {
  ConnectorMetadata,
  ConnectorType,
  ConnectionConfig,
  Mapping,
  ValueUpdate,
} from '../types.js';
import { BaseConnector, type BaseManagedConnection } from '../base-connector.js';

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
interface ManagedModbusConnection extends BaseManagedConnection<ModbusClient> {
  host: string;
  port: number;
  unitId: number;
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
export class ModbusConnector extends BaseConnector<ModbusClient, ManagedModbusConnection> {
  private logEntries: ModbusLogEntry[] = [];

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
   * Get the log entries (most recent last).
   * Optionally filter by a "since" timestamp to get only new entries.
   */
  getLogs(since?: string): ModbusLogEntry[] {
    if (!since) return [...this.logEntries];
    return this.logEntries.filter((e) => e.timestamp > since);
  }

  /**
   * Override log to also store entries in the ring buffer.
   */
  protected override log(level: ModbusLogEntry['level'], connectionName: string, message: string): void {
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
    super.log(level, connectionName, message);
  }

  /**
   * Extract Modbus-specific params (host, port, unitId) from the generic ConnectionConfig.
   */
  protected extractParams(config: ConnectionConfig): { host: string; port: number; unitId: number } {
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
   * Create a managed Modbus connection object.
   */
  protected createManagedConnection(config: ConnectionConfig, params: Record<string, unknown>): ManagedModbusConnection {
    return {
      config,
      host: params.host as string,
      port: params.port as number,
      unitId: params.unitId as number,
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
  protected applyParams(managed: ManagedModbusConnection, params: Record<string, unknown>): void {
    managed.host = params.host as string;
    managed.port = params.port as number;
    managed.unitId = params.unitId as number;
  }

  /**
   * Add a variable mapping. Validates the device address format.
   */
  override addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    // Validate the device address format
    this.parseDeviceAddress(mapping.deviceAddress);

    managed.mappings.set(mapping.id, mapping);
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
  initiateConnection(managed: ManagedModbusConnection): void {
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

        this.emitQualityUpdate(managed, 'good');
        this.startPolling(managed);
      })
      .catch((err: unknown) => {
        managed.connecting = false;
        this.handleConnectionError(managed, err);
      });
  }

  /**
   * Start polling mapped variables at the configured interval.
   */
  startPolling(managed: ManagedModbusConnection): void {
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

            if (mapping.nodeId) {
              updates.push({
                nodeId: mapping.nodeId,
                value,
                quality: 'good',
                timestamp: now,
              });
            }

            this.cacheValue(mapping.id, {
              nodeId: mapping.nodeId,
              deviceAddress: mapping.deviceAddress,
              connectionId: managed.config.id,
              value,
              quality: 'good',
              timestamp: now.toISOString(),
            });
          } catch (readErr: unknown) {
            const msg = (readErr as Error)?.message || 'Read failed';
            this.log('warn', managed.config.name, `Failed to read ${mapping.deviceAddress}: ${msg}`);

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

          this.emitValueUpdates(updates);
        }
      } catch (err: unknown) {
        this.handleConnectionError(managed, err);
      }
    };

    void poll();
    managed.pollingTimer = setInterval(() => void poll(), managed.config.pollingIntervalMs);
  }

  /**
   * Close the modbus-serial client connection.
   */
  closeClient(managed: ManagedModbusConnection): void {
    if (managed.client) {
      try {
        managed.client.close(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Read a single Modbus address from the client.
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
   * Create a new modbus-serial client instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createModbusClient(): ModbusClient {
    return new ModbusRTU();
  }
}

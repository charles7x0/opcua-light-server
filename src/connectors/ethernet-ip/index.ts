import { PLC } from 'ethernet-ip';
import type { PLCConnectOptions, TagValue } from 'ethernet-ip';
import { TimeoutError, CIPError, ConnectionError, SessionError } from 'ethernet-ip';
import type {
  ConnectorMetadata,
  ConnectorType,
  ConnectionConfig,
  Mapping,
  ValueUpdate,
} from '../types.js';
import { BaseConnector, type BaseManagedConnection } from '../base-connector.js';

/**
 * Represents a single managed EtherNet/IP connection with its polling state.
 */
interface ManagedEipConnection extends BaseManagedConnection<PLC> {
  host: string;
  port: number;
  slot: number;
  pollInProgress: boolean;
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
export class EthernetIPConnector extends BaseConnector<PLC, ManagedEipConnection> {
  /** Returns the protocol type identifier. */
  getType(): ConnectorType {
    return 'ethernet-ip';
  }

  /** Returns the metadata descriptor for this connector's protocol. */
  getMetadata(): ConnectorMetadata {
    return {
      type: 'ethernet-ip',
      displayName: 'EtherNet/IP',
      description: 'Connect to Rockwell/Allen-Bradley PLCs via EtherNet/IP (CIP)',
      icon: '🏭',
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
          required: false,
          defaultValue: 44818,
          min: 1,
          max: 65535,
        },
        {
          key: 'slot',
          label: 'Slot',
          type: 'number',
          required: false,
          defaultValue: 0,
          min: 0,
        },
      ],
    };
  }

  /**
   * Extract EtherNet/IP-specific params (host, port, slot) from the generic ConnectionConfig.
   */
  protected extractParams(config: ConnectionConfig): { host: string; port: number; slot: number } {
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
   * Create a managed EtherNet/IP connection object.
   */
  protected createManagedConnection(config: ConnectionConfig, params: Record<string, unknown>): ManagedEipConnection {
    return {
      config,
      host: params.host as string,
      port: params.port as number,
      slot: params.slot as number,
      client: null,
      state: 'disconnected',
      pollingTimer: null,
      reconnectTimer: null,
      pollInProgress: false,
      mappings: new Map(),
      connecting: false,
    };
  }

  /**
   * Apply extracted params to the managed connection (used by updateConnection).
   */
  protected applyParams(managed: ManagedEipConnection, params: Record<string, unknown>): void {
    managed.host = params.host as string;
    managed.port = params.port as number;
    managed.slot = params.slot as number;
  }

  /**
   * Add a variable mapping between a CIP tag name and an OPC UA node.
   */
  override addMapping(mapping: Mapping): void {
    const managed = this.connections.get(mapping.connectionId);
    if (!managed) {
      throw new Error(`Connection with id '${mapping.connectionId}' not found`);
    }

    managed.mappings.set(mapping.id, mapping);
  }

  /**
   * Initiate a connection to an EtherNet/IP device.
   */
  initiateConnection(managed: ManagedEipConnection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    const plc = this.createPLC();
    managed.client = plc;

    this.log('info', managed.config.name, `Connecting to ${managed.host}:${managed.port} slot ${managed.slot}...`);

    const connectOptions: PLCConnectOptions = {
      slot: managed.slot,
      connected: true,
      discover: true,
      timeout: 10000,
      autoReconnect: false,
    };

    plc.connect(managed.host, connectOptions)
      .then(async () => {
        managed.connecting = false;

        // Guard: plc may have been nullified by disconnectAndCleanup
        if (!managed.client) {
          this.log('warn', managed.config.name, 'Connection succeeded but PLC was already cleaned up — ignoring');
          return;
        }

        managed.state = 'connected';
        managed.errorMessage = undefined;

        this.log('info', managed.config.name, 'Connected successfully');

        this.emitQualityUpdate(managed, 'good');
        this.startPolling(managed);
      })
      .catch((err: unknown) => {
        managed.connecting = false;
        this.handleConnectionError(managed, err);
      });
  }

  /**
   * Start polling CIP tags at the configured interval.
   */
  startPolling(managed: ManagedEipConnection): void {
    if (managed.pollingTimer) return;

    const poll = (): void => {
      if (managed.state !== 'connected' || !managed.client) return;
      if (managed.mappings.size === 0) return;
      if (managed.pollInProgress) return;

      this.pollTags(managed);
    };

    poll();
    managed.pollingTimer = setInterval(poll, managed.config.pollingIntervalMs);
  }

  /**
   * Close the EtherNet/IP PLC connection.
   */
  closeClient(managed: ManagedEipConnection): void {
    if (managed.client) {
      managed.client.disconnect().catch(() => {});
    }
  }

  /**
   * Poll all mapped CIP tags for a connection.
   *
   * Error handling strategy:
   * - ConnectionError / SessionError → triggers full reconnection cycle
   * - TimeoutError / CIPError / unknown non-socket errors → marks quality "bad"
   *   but keeps the connection alive (no reconnect), so the next poll can recover
   * - Socket-level errors (ECONNRESET, EPIPE, etc.) → triggers reconnection
   */
  private pollTags(managed: ManagedEipConnection): void {
    if (!managed.client) return;

    managed.pollInProgress = true;

    const mappings = Array.from(managed.mappings.values());
    const tagNames = mappings.map((m) => m.deviceAddress);

    const readPromise = tagNames.length === 1
      ? managed.client.read(tagNames[0]).then((val) => [val])
      : managed.client.read(tagNames);

    readPromise
      .then((values: TagValue[]) => {
        managed.lastPollAt = new Date();

        const updates: ValueUpdate[] = [];
        for (let i = 0; i < mappings.length; i++) {
          const mapping = mappings[i];
          const value = values[i];
          if (value !== undefined) {
            const now = new Date();
            if (mapping.nodeId) {
              updates.push({
                nodeId: mapping.nodeId,
                value: this.normalizeTagValue(value),
                quality: 'good',
                timestamp: now,
              });
            }
            this.cacheValue(mapping.id, {
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
          this.emitValueUpdates(updates);
        }

        managed.pollInProgress = false;
      })
      .catch((err: unknown) => {
        managed.pollInProgress = false;
        if (err instanceof ConnectionError || err instanceof SessionError) {
          this.handleConnectionError(managed, err);
        } else if (err instanceof TimeoutError) {
          this.log('warn', managed.config.name, `Read timeout: ${(err as Error).message}`);
          this.emitQualityUpdate(managed, 'bad');
        } else if (err instanceof CIPError) {
          this.log('warn', managed.config.name, `CIP error reading tags: ${(err as Error).message}`);
          this.emitQualityUpdate(managed, 'bad');
        } else {
          const msg = (err as Error)?.message ?? 'Unknown error';
          if (msg.includes('ECONNRESET') || msg.includes('EPIPE') || msg.includes('socket') || msg.includes('Not connected') || msg.includes('Connection lost')) {
            this.handleConnectionError(managed, err);
          } else {
            this.log('warn', managed.config.name, `Poll error: ${msg}`);
            this.emitQualityUpdate(managed, 'bad');
          }
        }
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
   * Create a new ethernet-ip PLC instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createPLC(): PLC {
    return new PLC();
  }
}

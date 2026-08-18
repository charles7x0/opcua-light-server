import NodePCCC from 'nodepccc';
import type {
  ConnectorMetadata,
  ConnectorType,
  ConnectionConfig,
  Mapping,
  ValueUpdate,
} from '../types.js';
import { BaseConnector, type BaseManagedConnection } from '../base-connector.js';

/**
 * Represents a single managed PCCC connection with its polling state.
 */
interface ManagedPcccConnection extends BaseManagedConnection<NodePCCC> {
  host: string;
  port: number;
  slot: number;
  routing: number[] | undefined;
  pollInProgress: boolean;
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
export class PcccConnector extends BaseConnector<NodePCCC, ManagedPcccConnection> {
  /** Regex for validating PCCC file-based addresses. */
  private static readonly PCCC_ADDRESS_REGEX = /^([A-Z]{1,2})(\d+)?:(\d+)(\/(\d+|DN|EN|TT|ACC|PRE|LEN|POS|CU|CD|OV|UN|UA))?(\.\w+)?(,\d+)?$/i;

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
   * Extract PCCC-specific params (host, port, slot, routing) from the generic ConnectionConfig.
   */
  protected extractParams(config: ConnectionConfig): { host: string; port: number; slot: number; routing: number[] | undefined } {
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
   * Create a managed PCCC connection object.
   */
  protected createManagedConnection(config: ConnectionConfig, params: Record<string, unknown>): ManagedPcccConnection {
    return {
      config,
      host: params.host as string,
      port: params.port as number,
      slot: params.slot as number,
      routing: params.routing as number[] | undefined,
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
  protected applyParams(managed: ManagedPcccConnection, params: Record<string, unknown>): void {
    managed.host = params.host as string;
    managed.port = params.port as number;
    managed.slot = params.slot as number;
    managed.routing = params.routing as number[] | undefined;
  }

  /**
   * Add a variable mapping between a PCCC file address and an OPC UA node.
   * Validates the connection exists and the address format before registering.
   */
  override addMapping(mapping: Mapping): void {
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
    if (managed.client) {
      managed.client.addItems(mapping.deviceAddress);
    }
  }

  /**
   * Remove a variable mapping. Unregisters from nodepccc and removes from cache.
   */
  override removeMapping(id: string): void {
    for (const managed of this.connections.values()) {
      const mapping = managed.mappings.get(id);
      if (mapping) {
        // Unregister from nodepccc if PLC is connected
        if (managed.client) {
          managed.client.removeItems(mapping.deviceAddress);
        }
        managed.mappings.delete(id);
        this.currentValues.delete(id);
        return;
      }
    }
    throw new Error(`Mapping with id '${id}' not found`);
  }

  /**
   * Initiate a connection to the PLC using nodepccc.
   */
  initiateConnection(managed: ManagedPcccConnection): void {
    if (managed.connecting) return;
    managed.connecting = true;

    const plc = this.createPLC();
    managed.client = plc;

    this.log('info', managed.config.name, `Connecting to ${managed.host}:${managed.port}...`);

    // Set pass-through translation so nodepccc uses absolute PCCC addresses directly
    plc.setTranslationCB((tag: string) => tag);

    plc.initiateConnection(
      { host: managed.host, port: managed.port, routing: managed.routing },
      (err: unknown) => {
        managed.connecting = false;

        // Guard: plc may have been nullified by disconnectAndCleanup
        if (!managed.client) {
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
   * Start polling mapped addresses at the configured interval.
   */
  startPolling(managed: ManagedPcccConnection): void {
    if (managed.pollingTimer) return;

    const poll = (): void => {
      if (managed.state !== 'connected' || !managed.client) return;
      if (managed.mappings.size === 0) return;
      if (managed.pollInProgress) return;

      this.pollAddresses(managed);
    };

    poll();
    managed.pollingTimer = setInterval(poll, managed.config.pollingIntervalMs);
  }

  /**
   * Close the nodepccc PLC connection.
   */
  closeClient(managed: ManagedPcccConnection): void {
    if (managed.client) {
      managed.client.dropConnection();
    }
  }

  /**
   * Poll all registered PCCC addresses for a connection.
   */
  private pollAddresses(managed: ManagedPcccConnection): void {
    if (!managed.client) return;

    managed.pollInProgress = true;

    managed.client.readAllItems((anythingBad: boolean) => {
      managed.pollInProgress = false;

      // Guard: plc may have been cleaned up during read
      if (!managed.client) return;

      const mappings = Array.from(managed.mappings.values());

      if (anythingBad) {
        let allBad = true;
        for (const mapping of mappings) {
          const item = managed.client!.findItem(mapping.deviceAddress);
          if (item && item.quality === 'OK') {
            allBad = false;
            break;
          }
        }

        if (allBad) {
          this.handleConnectionError(managed, 'All items returned bad quality');
          return;
        }
      }

      // Process individual items
      managed.lastPollAt = new Date();
      const updates: ValueUpdate[] = [];

      for (const mapping of mappings) {
        const item = managed.client!.findItem(mapping.deviceAddress);
        if (!item) continue;

        const now = new Date();
        const quality = item.quality === 'OK' ? 'good' : 'bad';

        this.cacheValue(mapping.id, {
          nodeId: mapping.nodeId,
          deviceAddress: mapping.deviceAddress,
          connectionId: managed.config.id,
          value: item.value,
          quality,
          timestamp: now.toISOString(),
        });

        if (mapping.nodeId) {
          updates.push({
            nodeId: mapping.nodeId,
            value: item.value,
            quality,
            timestamp: now,
          });
        }
      }

      if (updates.length > 0) {
        this.emitValueUpdates(updates);
      }
    });
  }

  /**
   * Create a new nodepccc instance.
   * Separated into its own method to allow mocking in tests.
   */
  protected createPLC(): NodePCCC {
    return new NodePCCC();
  }
}

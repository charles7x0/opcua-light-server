import { Connector, ConnectorType, ConnectorMetadata, ParamFieldSchema, ConnectionStatus, CurrentValue, ValueUpdateCallback } from './types.js';
import type { SseHub } from '../../api/sse-hub.js';

const STATUS_POLL_INTERVAL_MS = 3_000;

/**
 * Central registry that manages all connector instances, provides lifecycle
 * control (start/stop all), and aggregates status and values across protocols.
 */
export class ConnectorRegistry {
  private connectors: Map<ConnectorType, Connector> = new Map();
  private metadata: Map<ConnectorType, ConnectorMetadata> = new Map();
  private valueUpdateCallback: ValueUpdateCallback | null = null;
  private sseHub: SseHub | null = null;
  private statusPollInterval: NodeJS.Timeout | null = null;
  private lastStatusSnapshot: string = '[]';

  /** Set the SseHub instance for broadcasting connector events. */
  setSseHub(sseHub: SseHub): void {
    this.sseHub = sseHub;
  }

  /** Register a connector instance by its type. */
  register(connector: Connector, metadata?: ConnectorMetadata): void {
    this.connectors.set(connector.getType(), connector);
    if (metadata) {
      this.metadata.set(connector.getType(), metadata);
    }
    connector.onValueUpdate((updates) => {
      if (this.valueUpdateCallback) {
        this.valueUpdateCallback(updates);
      }
      this.broadcastValues();
    });
  }

  /** Start all registered connectors. */
  startAll(): void {
    for (const connector of this.connectors.values()) {
      connector.start();
    }
    this.startStatusPolling();
  }

  /** Stop all registered connectors. */
  stopAll(): void {
    this.stopStatusPolling();
    for (const connector of this.connectors.values()) {
      connector.stop();
    }
    // Emit final status after stopping (all disconnected)
    this.broadcastStatus();
  }

  /** Get a connector by type. Returns undefined if not registered. */
  getConnector(type: ConnectorType): Connector | undefined {
    return this.connectors.get(type);
  }

  /** Aggregated status across all connectors. */
  getAggregatedStatus(): ConnectionStatus[] {
    const statuses: ConnectionStatus[] = [];
    for (const connector of this.connectors.values()) {
      statuses.push(...connector.getStatus());
    }
    return statuses;
  }

  /** Aggregated current values from all connectors. */
  getAggregatedValues(): CurrentValue[] {
    const values: CurrentValue[] = [];
    for (const connector of this.connectors.values()) {
      values.push(...connector.getCurrentValues());
    }
    return values;
  }

  /** Get metadata for all registered connectors. */
  getProtocolsMetadata(): ConnectorMetadata[] {
    return Array.from(this.metadata.values());
  }

  /** Get metadata for a specific connector type. */
  getProtocolMetadata(type: ConnectorType): ConnectorMetadata | undefined {
    return this.metadata.get(type);
  }

  /** Get the paramsSchema for a connector type (for validation). */
  getParamsSchema(type: ConnectorType): ParamFieldSchema[] | undefined {
    return this.metadata.get(type)?.paramsSchema;
  }

  /** Register a single callback to receive forwarded value updates from all connectors. */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }

  /**
   * Start periodic status polling. Compares current status JSON with the
   * previous snapshot and broadcasts `connector:status` only on change.
   */
  private startStatusPolling(): void {
    if (this.statusPollInterval) return;

    // Capture initial snapshot
    this.lastStatusSnapshot = JSON.stringify(this.getAggregatedStatus());

    this.statusPollInterval = setInterval(() => {
      this.checkAndBroadcastStatus();
    }, STATUS_POLL_INTERVAL_MS);
  }

  /** Stop the status polling interval. */
  private stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  /** Compare current status with cached snapshot and broadcast on change. */
  private checkAndBroadcastStatus(): void {
    const currentStatus = this.getAggregatedStatus();
    const currentJson = JSON.stringify(currentStatus);

    if (currentJson !== this.lastStatusSnapshot) {
      this.lastStatusSnapshot = currentJson;
      this.sseHub?.broadcast('connector:status', currentStatus);
    }
  }

  /** Broadcast current connector status unconditionally. */
  private broadcastStatus(): void {
    if (!this.sseHub) return;
    const status = this.getAggregatedStatus();
    this.lastStatusSnapshot = JSON.stringify(status);
    this.sseHub.broadcast('connector:status', status);
  }

  /**
   * Broadcast aggregated connector values via SSE.
   * Only emits when at least one connector is active (has a 'connected' status).
   */
  private broadcastValues(): void {
    if (!this.sseHub) return;

    const statuses = this.getAggregatedStatus();
    const hasActiveConnector = statuses.some((s) => s.state === 'connected');
    if (!hasActiveConnector) return;

    const values = this.getAggregatedValues();
    this.sseHub.broadcast('connector:values', values);
  }
}

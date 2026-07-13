import { Connector, ConnectorType, ConnectionStatus, CurrentValue, ValueUpdateCallback } from './types.js';

/**
 * Central registry that manages all connector instances, provides lifecycle
 * control (start/stop all), and aggregates status and values across protocols.
 */
export class ConnectorRegistry {
  private connectors: Map<ConnectorType, Connector> = new Map();
  private valueUpdateCallback: ValueUpdateCallback | null = null;

  /** Register a connector instance by its type. */
  register(connector: Connector): void {
    this.connectors.set(connector.getType(), connector);
    connector.onValueUpdate((updates) => {
      if (this.valueUpdateCallback) {
        this.valueUpdateCallback(updates);
      }
    });
  }

  /** Start all registered connectors. */
  startAll(): void {
    for (const connector of this.connectors.values()) {
      connector.start();
    }
  }

  /** Stop all registered connectors. */
  stopAll(): void {
    for (const connector of this.connectors.values()) {
      connector.stop();
    }
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

  /** Register a single callback to receive forwarded value updates from all connectors. */
  onValueUpdate(callback: ValueUpdateCallback): void {
    this.valueUpdateCallback = callback;
  }
}

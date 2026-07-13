/**
 * Internal types for the Modbus TCP Connector module.
 * These types are NOT exported from the connectors barrel —
 * they are implementation details of the Modbus connector.
 */

import type { ConnectionConfig, ConnectionStatus, Mapping } from '../types.js';

/** Modbus function code address types. */
export type ModbusAddressType = 'HR' | 'IR' | 'CO' | 'DI';

/** Parsed device address structure for Modbus. */
export interface ParsedModbusAddress {
  type: ModbusAddressType;
  address: number;
  count: number;
}

/** Represents a single managed Modbus TCP connection with its polling state. */
export interface ManagedConnection {
  config: ConnectionConfig;
  host: string;
  port: number;
  unitId: number;
  client: unknown | null;  // ModbusRTU client instance
  state: ConnectionStatus['state'];
  lastPollAt?: Date;
  errorMessage?: string;
  pollingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mappings: Map<string, Mapping>;
  connecting: boolean;
}

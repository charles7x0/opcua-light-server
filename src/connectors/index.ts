/**
 * Multi-protocol connector barrel.
 * Each connector implements the shared `Connector` interface from `./types.ts`.
 *
 * Supported protocols:
 * - S7 (Siemens S7-300/400/1200/1500 via nodes7)
 * - Modbus TCP (via modbus-serial)
 * - EtherNet/IP (Rockwell Logix5000 via ethernet-ip, with tag discovery)
 * - PCCC (Allen-Bradley SLC 500, MicroLogix, PLC-5 via nodepccc)
 */
export * from './types.js';
export { ConnectorRegistry } from './connector-registry.js';
export { IpcBridge } from './ipc-bridge.js';
export { S7Connector } from './s7/index.js';
export { ModbusConnector } from './modbus-tcp/index.js';
export { EthernetIPConnector } from './ethernet-ip/index.js';
export { PcccConnector } from './pccc/index.js';

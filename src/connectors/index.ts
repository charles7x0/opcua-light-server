/**
 * Multi-protocol connector barrel.
 * Connectors are discovered dynamically via the plugin loader at startup.
 */
export * from './core/types.js';
export { BaseConnector, type BaseManagedConnection } from './core/base-connector.js';
export { ConnectorRegistry } from './core/connector-registry.js';
export { IpcBridge } from './core/ipc-bridge.js';
export { loadPlugins } from './core/plugin-loader.js';
export { validateParams } from './core/params-validator.js';

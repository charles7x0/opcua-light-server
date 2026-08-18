/**
 * Multi-protocol connector barrel.
 * Connectors are discovered dynamically via the plugin loader at startup.
 * Individual connector classes are no longer statically imported.
 */
export * from './types.js';
export { BaseConnector, type BaseManagedConnection } from './base-connector.js';
export { ConnectorRegistry } from './connector-registry.js';
export { IpcBridge } from './ipc-bridge.js';
export { loadPlugins } from './plugin-loader.js';
export { validateParams } from './params-validator.js';

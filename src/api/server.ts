/**
 * API server entry point.
 * Initializes the database, creates dependencies, and starts the Express server.
 */

import { Database } from '../db/database.js';
import { ProcessManager } from '../process-manager/index.js';
import { ConfigGenerator } from '../config-generator/index.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { ConnectorRegistry, IpcBridge, loadPlugins } from '../connectors/index.js';
import { ConnectorRepository } from '../db/repositories/connector-repository.js';
import { TofuManager } from '../tofu-manager/index.js';
import { loadAuthConfig } from '../auth/config.js';
import { createApp } from './app.js';
import { logService } from '../log/index.js';

/** Default port for the Control API. */
const DEFAULT_PORT = 3100;

/** Default OPC UA runtime port. */
const DEFAULT_OPCUA_PORT = 4840;

/** Default SQLite database file path. */
const DEFAULT_DB_PATH = 'runtime/opcua-light.db';

/** Default path to the open62541 runtime executable. */
const DEFAULT_RUNTIME_PATH = 'runtime/opcua-runtime';

/** Default path for the generated runtime configuration file. */
const DEFAULT_CONFIG_PATH = 'runtime/config.json';

/**
 * Start the Control API server.
 */
async function main(): Promise<void> {
  // ─── Configuration from environment ─────────────────────────────────────────
  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const opcuaPort = parseInt(process.env.OPCUA_PORT || String(DEFAULT_OPCUA_PORT), 10);
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const runtimePath = process.env.RUNTIME_PATH || DEFAULT_RUNTIME_PATH;
  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;

  // ─── Initialize Database ────────────────────────────────────────────────────
  const database = new Database(dbPath);
  logService.info('Server', `Database initialized at: ${dbPath}`);
  console.log(`Database initialized at: ${dbPath}`);

  // ─── Create Dependencies ────────────────────────────────────────────────────
  const processManager = new ProcessManager(runtimePath, configPath);
  const configGenerator = new ConfigGenerator(database);
  const authConfig = loadAuthConfig();

  // ─── Initialize TOFU Manager ────────────────────────────────────────────────
  const tofuManager = new TofuManager('data/pki', processManager);

  // ─── Initialize Connector System ──────────────────────────────────────────
  const connectorRepo = new ConnectorRepository(database);
  const connectorRegistry = new ConnectorRegistry();

  // Load connector plugins dynamically from built-in and optional external directories
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const builtInConnectorsDir = path.join(__dirname, '../connectors/protocols');
  const externalPluginsDir = process.env.CONNECTOR_PLUGINS_DIR;

  const { loaded, skipped } = await loadPlugins(builtInConnectorsDir, externalPluginsDir);

  for (const plugin of loaded) {
    connectorRegistry.register(plugin.connector, plugin.metadata);
  }

  logService.info('Server', `Loaded ${loaded.length} connector plugin(s), skipped ${skipped.length}`);
  console.log(`Loaded ${loaded.length} connector plugin(s), skipped ${skipped.length}`);

  for (const skip of skipped) {
    logService.warn('Server', `Skipped plugin "${skip.directory}": ${skip.reason}`);
  }

  // Load connections and mappings from DB into connectors
  const connections = connectorRepo.findAllConnections();
  for (const conn of connections) {
    const connector = connectorRegistry.getConnector(conn.type);
    if (connector) {
      connector.addConnection(conn);
    }
  }

  const mappings = connectorRepo.findAllMappings();
  for (const mapping of mappings) {
    const conn = connectorRepo.findConnectionById(mapping.connectionId);
    if (conn) {
      const connector = connectorRegistry.getConnector(conn.type);
      if (connector) {
        connector.addMapping(mapping);
      }
    }
  }

  console.log(`Connector system initialized: ${connections.length} connection(s), ${mappings.length} mapping(s)`);
  logService.info('Server', `Connector system initialized: ${connections.length} connection(s), ${mappings.length} mapping(s)`);

  // Wire value updates to the runtime process via the IPC bridge
  const ipcBridge = new IpcBridge(configGenerator, processManager, database);
  connectorRegistry.onValueUpdate((updates) => ipcBridge.handleValueUpdates(updates));

  // Register crash handler for logging
  processManager.onCrash((reason) => {
    console.error(`OPC UA Runtime crashed: ${reason}`);
    logService.error('Server', `OPC UA Runtime crashed: ${reason}`);
    // Stop all connector polling when the runtime crashes since there's no process to receive updates
    connectorRegistry.stopAll();
  });

  // ─── Create and Start App ───────────────────────────────────────────────────
  const { app, sseHub } = createApp({ database, processManager, configGenerator, connectorRegistry, connectorRepository: connectorRepo, authConfig, tofuManager, opcuaPort });

  // ─── Start HTTP Server ────────────────────────────────────────────────────
  // The Control API always uses plain HTTP. The OPC UA security mode (None/Sign/SignAndEncrypt)
  // applies to the OPC UA runtime's client connections, NOT to the REST API transport.
  // Using HTTPS for the Control API would break the Vite dev proxy and is unnecessary
  // since the API is typically accessed on localhost or a trusted local network.
  let server: import('http').Server;

  server = app.listen(port, () => {
    console.log(`Control API listening on port ${port} (HTTP)`);
    logService.info('Server', `Control API listening on port ${port} (HTTP)`);
  });

  // ─── Auto-start OPC UA Runtime ──────────────────────────────────────────────
  try {
    // Initialize PKI directories before starting runtime (Requirement 1.5)
    await tofuManager.initialize();
    console.log('PKI directories initialized.');
    logService.info('Server', 'PKI directories initialized');

    configGenerator.writeToFile(configPath);
    const result = await processManager.start();
    connectorRegistry.startAll();
    console.log(`OPC UA Runtime auto-started (PID: ${result.pid})`);
    logService.info('Server', `OPC UA Runtime auto-started (PID: ${result.pid})`);
  } catch (err) {
    console.error('Failed to auto-start OPC UA Runtime:', (err as Error).message);
    logService.error('Server', `Failed to auto-start OPC UA Runtime: ${(err as Error).message}`);
    console.error('Use the Dashboard or POST /server/start to start manually.');
  }

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    logService.info('Server', `Received ${signal}. Shutting down gracefully...`);

    // Shut down SSE connections
    sseHub.shutdown();
    console.log('SSE connections closed.');

    // Stop all Connector polling
    connectorRegistry.stopAll();
    console.log('Connectors stopped.');

    // Stop the OPC UA runtime if running
    try {
      const status = processManager.getStatus();
      if (status.state === 'running') {
        await processManager.stop();
        console.log('OPC UA Runtime stopped.');
      }
    } catch (err) {
      console.error('Error stopping runtime:', err);
    }

    // Close the HTTP server
    server.close(() => {
      console.log('Server closed.');

      // Close the database connection
      database.close();
      console.log('Database connection closed.');

      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ─── Global Error Safety Nets ───────────────────────────────────────────────
// Prevent the process from crashing on unhandled promise rejections or
// uncaught exceptions from third-party libraries (e.g., socket errors from
// the ethernet-ip library when a remote PLC drops the connection abruptly).
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process kept alive):', err.message);
  logService.error('Server', `Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('Unhandled rejection (process kept alive):', msg);
  logService.error('Server', `Unhandled rejection: ${msg}`);
});

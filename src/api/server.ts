/**
 * API server entry point.
 * Initializes the database, creates dependencies, and starts the Express server.
 */

import { Database } from '../db/database.js';
import { ProcessManager } from '../process-manager/index.js';
import { ConfigGenerator } from '../config-generator/index.js';
import { S7Connector } from '../s7-connector/index.js';
import { S7Repository } from '../db/repositories/s7-repository.js';
import { loadAuthConfig } from '../auth/config.js';
import { createApp } from './app.js';
import { logService } from '../log/index.js';

/** Default port for the Control API. */
const DEFAULT_PORT = 3100;

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
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const runtimePath = process.env.RUNTIME_PATH || DEFAULT_RUNTIME_PATH;
  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;

  // ─── Initialize Database ────────────────────────────────────────────────────
  const database = new Database(dbPath);
  console.log(`Database initialized at: ${dbPath}`);

  // ─── Create Dependencies ────────────────────────────────────────────────────
  const processManager = new ProcessManager(runtimePath, configPath);
  const configGenerator = new ConfigGenerator(database);
  const authConfig = loadAuthConfig();

  // ─── Initialize S7 Connector ────────────────────────────────────────────────
  const s7Connector = new S7Connector();
  const s7Repo = new S7Repository(database);

  // Load existing S7 connections and mappings from the database
  const connections = s7Repo.findAllConnections();
  for (const conn of connections) {
    s7Connector.addConnection(conn);
  }

  const mappings = s7Repo.findAllMappings();
  for (const mapping of mappings) {
    s7Connector.addMapping(mapping);
  }

  console.log(`S7 Connector initialized: ${connections.length} connection(s), ${mappings.length} mapping(s)`);

  // Wire S7 value updates to the runtime process via stdin pipe IPC.
  // When the S7 Connector reads values from PLCs, it sends them as JSON
  // messages to the runtime's stdin for real-time node value updates.
  //
  // The S7 Connector uses database UUIDs as nodeId, but the C runtime
  // expects OPC UA node IDs (ns=X;s=Path.Name). We build a cached lookup map.
  let uuidToOpcUaId: Map<string, string> | null = null;

  function buildNodeIdMap(): Map<string, string> {
    const config = configGenerator.generate();
    const db = database.getConnection();
    const map = new Map<string, string>();
    for (const ns of config.namespaces) {
      for (const node of ns.nodes) {
        const row = db.prepare(
          `SELECT n.id FROM nodes n
           JOIN namespaces ns ON n.namespace_id = ns.id
           WHERE n.name = ? AND ns.name = ?`
        ).get(node.name, ns.name) as { id: string } | undefined;
        if (row) {
          map.set(row.id, node.nodeId);
        }
      }
    }
    return map;
  }

  s7Connector.onValueUpdate((updates) => {
    const status = processManager.getStatus();
    if (status.state !== 'running') {
      logService.debug('S7-IPC', `Skipping ${updates.length} update(s): runtime not running`);
      return;
    }

    // Lazily build the map (invalidated on address space changes via auto-reload)
    if (!uuidToOpcUaId) {
      uuidToOpcUaId = buildNodeIdMap();
      logService.info('S7-IPC', `Built node ID map: ${uuidToOpcUaId.size} mapping(s)`);
    }

    // Resolve UUIDs to OPC UA node IDs
    const resolvedUpdates = updates
      .filter((u) => {
        if (!uuidToOpcUaId!.has(u.nodeId)) {
          // Rebuild map in case a new node was added
          logService.warn('S7-IPC', `Node UUID ${u.nodeId} not in map, rebuilding...`);
          uuidToOpcUaId = buildNodeIdMap();
          return uuidToOpcUaId.has(u.nodeId);
        }
        return true;
      })
      .map((u) => ({
        nodeId: uuidToOpcUaId!.get(u.nodeId)!,
        value: u.value,
        quality: u.quality,
        timestamp: u.timestamp.toISOString(),
      }));

    if (resolvedUpdates.length === 0) {
      logService.warn('S7-IPC', `No updates resolved (${updates.length} input, 0 matched)`);
      return;
    }

    const message = JSON.stringify({
      type: 'value_update',
      updates: resolvedUpdates,
    });

    try {
      processManager.writeToStdin(message + '\n');
      logService.debug('S7-IPC', `Sent ${resolvedUpdates.length} value(s) to runtime stdin`);
    } catch (err) {
      logService.error('S7-IPC', `Failed to write to stdin: ${(err as Error).message}`);
    }
  });

  // Register crash handler for logging
  processManager.onCrash((reason) => {
    console.error(`OPC UA Runtime crashed: ${reason}`);
    // Stop S7 polling when the runtime crashes since there's no process to receive updates
    s7Connector.stop();
  });

  // ─── Create and Start App ───────────────────────────────────────────────────
  const app = createApp({ database, processManager, configGenerator, s7Connector, authConfig });

  const server = app.listen(port, () => {
    console.log(`Control API listening on port ${port}`);
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    // Stop S7 Connector polling
    s7Connector.stop();
    console.log('S7 Connector stopped.');

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
      console.log('HTTP server closed.');

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

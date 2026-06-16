/**
 * Stress Test: Multiple Concurrent OPC UA Clients
 *
 * Spawns N clients that connect simultaneously, perform reads/writes,
 * then disconnect. Measures connection success rate and latencies.
 *
 * Usage:
 *   npx tsx tests/stress/stress-clients.ts [numClients] [durationSeconds]
 *
 * Prerequisites:
 *   - Server running: npm run dev (or npm start)
 *   - Runtime started: POST /api/server/start
 *   - Security set to None for easy testing: PUT /api/security/policy { "mode": "None" }
 *
 * Example:
 *   npx tsx tests/stress/stress-clients.ts 20 60
 */

import { AttributeIds, DataType } from 'node-opcua-client';
import {
  DEFAULT_CONFIG,
  StressConfig,
  MetricsCollector,
  createClient,
  disconnectClient,
  sleep,
  printReport,
  getServerStatus,
  getConnectedClients,
} from './helpers.js';

async function stressClients(config: StressConfig): Promise<void> {
  const metrics = new MetricsCollector();

  console.log(`\n🔥 Stress Test: ${config.numClients} concurrent OPC UA clients`);
  console.log(`   Endpoint: ${config.endpoint}`);
  console.log(`   Duration: ${config.durationMs / 1000}s`);
  console.log(`   Read interval: ${config.readIntervalMs}ms`);
  console.log(`   Write interval: ${config.writeIntervalMs}ms\n`);

  // Connect all clients
  console.log('⏳ Connecting clients...');
  const clients: Array<{ client: any; session: any }> = [];

  const connectionPromises = Array.from({ length: config.numClients }, async (_, i) => {
    try {
      const conn = await createClient(config);
      clients.push(conn);
      metrics.clientsConnected++;
      if ((i + 1) % 5 === 0) {
        console.log(`   ✓ ${i + 1}/${config.numClients} connected`);
      }
    } catch (err) {
      metrics.clientsFailed++;
      console.log(`   ✗ Client ${i + 1} failed: ${(err as Error).message}`);
    }
  });

  await Promise.all(connectionPromises);
  console.log(`\n✓ ${metrics.clientsConnected} connected, ${metrics.clientsFailed} failed`);

  // Check server-side view
  const status = await getServerStatus();
  const sessionList = await getConnectedClients();
  console.log(`   Server reports: ${status.connectedClients} clients, ${sessionList.length} sessions`);

  if (clients.length === 0) {
    console.log('\n✗ No clients connected. Aborting.');
    return;
  }

  // Run read/write operations for the configured duration
  console.log(`\n⏳ Running operations for ${config.durationMs / 1000}s...`);
  const endTime = Date.now() + config.durationMs;
  let running = true;

  // Read loop — each client reads ServerStatus_CurrentTime
  const readNodeId = 'i=2258'; // Server.ServerStatus.CurrentTime

  const clientWorkers = clients.map(async ({ session }, clientIdx) => {
    while (running && Date.now() < endTime) {
      try {
        const start = Date.now();
        const result = await session.read({
          nodeId: readNodeId,
          attributeId: AttributeIds.Value,
        });
        const latency = Date.now() - start;
        metrics.recordRead(latency);
      } catch {
        metrics.recordReadError();
      }

      await sleep(config.readIntervalMs + Math.random() * 50);
    }
  });

  // Wait for duration
  await Promise.race([
    Promise.all(clientWorkers),
    sleep(config.durationMs).then(() => { running = false; }),
  ]);
  running = false;

  // Allow workers to finish
  await sleep(1000);

  // Disconnect all clients
  console.log('⏳ Disconnecting clients...');
  await Promise.all(clients.map(({ client, session }) => disconnectClient(client, session)));
  console.log('✓ All clients disconnected');

  // Final report
  printReport('Stress Test: Multiple Clients', metrics.getReport());
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const numClients = parseInt(process.argv[2] || '10', 10);
const durationSec = parseInt(process.argv[3] || '30', 10);

const config: StressConfig = {
  ...DEFAULT_CONFIG,
  numClients,
  durationMs: durationSec * 1000,
};

stressClients(config).catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});

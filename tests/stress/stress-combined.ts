/**
 * Stress Test: Combined Full Load
 *
 * The most comprehensive stress test: creates many variables, connects
 * many clients, and runs continuous operations while monitoring the
 * REST API responsiveness and the dashboard's connected clients endpoint.
 *
 * Usage:
 *   npx tsx tests/stress/stress-combined.ts [numClients] [numVariables] [durationSeconds]
 *
 * Prerequisites:
 *   - Server running: npm run dev (or npm start)
 *   - Runtime started: POST /api/server/start
 *   - Security set to None: PUT /api/security/policy { "mode": "None" }
 *
 * Example:
 *   npx tsx tests/stress/stress-combined.ts 20 200 60
 */

import { AttributeIds, DataType } from 'node-opcua-client';
import {
  DEFAULT_CONFIG,
  StressConfig,
  MetricsCollector,
  createClient,
  disconnectClient,
  createNamespace,
  createObjectNode,
  createNode,
  reloadServer,
  getServerStatus,
  getConnectedClients,
  apiRequest,
  sleep,
  printReport,
} from './helpers.js';

interface CombinedMetrics {
  opcua: ReturnType<MetricsCollector['getReport']>;
  apiCalls: number;
  apiErrors: number;
  avgApiLatencyMs: number;
  maxApiLatencyMs: number;
  clientsSeenByDashboard: number;
  connectionChurnSuccess: number;
  connectionChurnFailed: number;
}

async function stressCombined(config: StressConfig): Promise<void> {
  const opcuaMetrics = new MetricsCollector();
  let apiCalls = 0;
  let apiErrors = 0;
  const apiLatencies: number[] = [];
  let clientsSeenByDashboard = 0;
  let connectionChurnSuccess = 0;
  let connectionChurnFailed = 0;

  console.log(`\n🔥 Combined Stress Test`);
  console.log(`   Clients: ${config.numClients}`);
  console.log(`   Variables: ${config.numVariables}`);
  console.log(`   Duration: ${config.durationMs / 1000}s`);
  console.log(`   Endpoint: ${config.endpoint}\n`);

  // ─── Phase 1: Create Variables ────────────────────────────────────────────
  console.log('═══ Phase 1: Create Variables ═══');
  const timestamp = Date.now();
  const ns = await createNamespace(`CombStress_${timestamp}`, `urn:opcua-light:combined-stress:${timestamp}`);

  const nodesPerObject = 50;
  const numObjects = Math.ceil(config.numVariables / nodesPerObject);
  const objects: { id: string }[] = [];
  for (let i = 0; i < numObjects; i++) {
    objects.push(await createObjectNode(`CombGroup_${i}`, ns.id));
  }

  const dataTypes = ['Boolean', 'Int32', 'Float', 'Double', 'String'];
  let nodesCreated = 0;
  for (let i = 0; i < config.numVariables; i++) {
    const dt = dataTypes[i % dataTypes.length];
    try {
      await createNode(`CombVar_${i}`, dt, ns.id, objects[Math.floor(i / nodesPerObject)].id);
      nodesCreated++;
      if (nodesCreated % 50 === 0) console.log(`   ✓ ${nodesCreated}/${config.numVariables} nodes`);
    } catch { /* continue */ }
  }
  console.log(`   ✓ ${nodesCreated} nodes created\n`);

  // Reload runtime
  console.log('⏳ Reloading runtime...');
  await reloadServer();
  await sleep(3000);
  console.log('   ✓ Runtime reloaded\n');

  // ─── Phase 2: Connect Clients ─────────────────────────────────────────────
  console.log('═══ Phase 2: Connect Clients ═══');
  const clients: Array<{ client: any; session: any }> = [];

  const batchSize = 5;
  for (let batch = 0; batch < config.numClients; batch += batchSize) {
    const batchPromises = Array.from(
      { length: Math.min(batchSize, config.numClients - batch) },
      async (_, i) => {
        try {
          const conn = await createClient(config);
          clients.push(conn);
          opcuaMetrics.clientsConnected++;
        } catch (err) {
          opcuaMetrics.clientsFailed++;
        }
      }
    );
    await Promise.all(batchPromises);
    console.log(`   ✓ ${clients.length}/${config.numClients} connected`);
  }

  // Verify dashboard sees the clients
  await sleep(2000);
  const dashboardClients = await getConnectedClients();
  clientsSeenByDashboard = dashboardClients.length;
  console.log(`   Dashboard sees: ${clientsSeenByDashboard} sessions\n`);

  // ─── Phase 3: Run Combined Workload ───────────────────────────────────────
  console.log('═══ Phase 3: Combined Workload ═══');
  const endTime = Date.now() + config.durationMs;
  let running = true;

  // Worker A: OPC UA reads/writes
  const opcuaWorkers = clients.map(async ({ session }) => {
    const readNodeId = 'i=2258';
    while (running && Date.now() < endTime) {
      try {
        const start = Date.now();
        await session.read({ nodeId: readNodeId, attributeId: AttributeIds.Value });
        opcuaMetrics.recordRead(Date.now() - start);
      } catch {
        opcuaMetrics.recordReadError();
      }
      await sleep(config.readIntervalMs + Math.random() * 100);
    }
  });

  // Worker B: REST API polling (simulates dashboard)
  const apiWorker = async () => {
    while (running && Date.now() < endTime) {
      try {
        const start = Date.now();
        await getServerStatus();
        const latency = Date.now() - start;
        apiLatencies.push(latency);
        apiCalls++;
      } catch {
        apiErrors++;
      }

      try {
        const start = Date.now();
        await getConnectedClients();
        const latency = Date.now() - start;
        apiLatencies.push(latency);
        apiCalls++;
      } catch {
        apiErrors++;
      }

      await sleep(3000); // Same interval as dashboard polling
    }
  };

  // Worker C: Connection churn (connect/disconnect random clients)
  const churnWorker = async () => {
    while (running && Date.now() < endTime) {
      await sleep(5000); // Every 5 seconds, churn one client

      try {
        const conn = await createClient(config);
        connectionChurnSuccess++;
        await sleep(2000); // Stay connected briefly
        await disconnectClient(conn.client, conn.session);
      } catch {
        connectionChurnFailed++;
      }
    }
  };

  // Progress reporter
  const progressWorker = async () => {
    while (running && Date.now() < endTime) {
      await sleep(10000);
      if (!running) break;
      const elapsed = (Date.now() - (endTime - config.durationMs)) / 1000;
      console.log(`   [${elapsed.toFixed(0)}s] reads=${opcuaMetrics.totalReads} api=${apiCalls} churn=${connectionChurnSuccess}`);
    }
  };

  await Promise.race([
    Promise.all([...opcuaWorkers, apiWorker(), churnWorker(), progressWorker()]),
    sleep(config.durationMs).then(() => { running = false; }),
  ]);
  running = false;
  await sleep(2000);

  // ─── Phase 4: Disconnect & Cleanup ────────────────────────────────────────
  console.log('\n═══ Phase 4: Cleanup ═══');
  console.log('⏳ Disconnecting all clients...');
  await Promise.all(clients.map(({ client, session }) => disconnectClient(client, session)));
  console.log('   ✓ All clients disconnected');

  // Delete stress namespace
  try {
    const namespaces = await apiRequest<Array<{ id: string; name: string }>>('GET', '/api/namespaces');
    const stressNs = namespaces.find(n => n.name.startsWith('CombStress'));
    if (stressNs) {
      await apiRequest('DELETE', `/api/namespaces/${stressNs.id}`);
      await reloadServer();
      console.log('   ✓ Stress namespace cleaned up');
    }
  } catch {
    console.log('   ⚠ Cleanup failed');
  }

  // ─── Report ───────────────────────────────────────────────────────────────
  const avgApi = apiLatencies.length > 0
    ? apiLatencies.reduce((a, b) => a + b, 0) / apiLatencies.length
    : 0;
  const maxApi = apiLatencies.length > 0 ? Math.max(...apiLatencies) : 0;

  const report = opcuaMetrics.getReport();
  printReport('Combined Stress Test: OPC UA Operations', report);

  console.log(`${'─'.repeat(60)}`);
  console.log('  REST API Metrics:');
  console.log(`   API calls:              ${apiCalls}`);
  console.log(`   API errors:             ${apiErrors}`);
  console.log(`   Avg API latency:        ${avgApi.toFixed(1)}ms`);
  console.log(`   Max API latency:        ${maxApi.toFixed(1)}ms`);
  console.log(`   Clients seen on dash:   ${clientsSeenByDashboard}`);
  console.log(`${'─'.repeat(60)}`);
  console.log('  Connection Churn:');
  console.log(`   Successful connects:    ${connectionChurnSuccess}`);
  console.log(`   Failed connects:        ${connectionChurnFailed}`);
  console.log(`${'─'.repeat(60)}\n`);

  // Summary verdict
  const passed = report.readErrors === 0 && apiErrors === 0 && opcuaMetrics.clientsFailed === 0;
  if (passed) {
    console.log('✅ STRESS TEST PASSED — no errors detected');
  } else {
    console.log('⚠️  STRESS TEST COMPLETED WITH ISSUES:');
    if (report.readErrors > 0) console.log(`   - ${report.readErrors} OPC UA read errors`);
    if (apiErrors > 0) console.log(`   - ${apiErrors} REST API errors`);
    if (opcuaMetrics.clientsFailed > 0) console.log(`   - ${opcuaMetrics.clientsFailed} client connection failures`);
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const numClients = parseInt(process.argv[2] || '20', 10);
const numVariables = parseInt(process.argv[3] || '200', 10);
const durationSec = parseInt(process.argv[4] || '60', 10);

const config: StressConfig = {
  ...DEFAULT_CONFIG,
  numClients,
  numVariables,
  durationMs: durationSec * 1000,
};

stressCombined(config).catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});

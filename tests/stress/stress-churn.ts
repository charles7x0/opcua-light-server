/**
 * Stress Test: Connection Churn
 *
 * Rapidly connects and disconnects OPC UA clients to stress session
 * creation/teardown, memory management, and the dashboard's ability
 * to track changing session counts.
 *
 * Usage:
 *   npx tsx tests/stress/stress-churn.ts [totalConnections] [concurrency] [holdTimeMs]
 *
 * Prerequisites:
 *   - Server running: npm run dev (or npm start)
 *   - Runtime started: POST /api/server/start
 *   - Security set to None: PUT /api/security/policy { "mode": "None" }
 *
 * Example:
 *   npx tsx tests/stress/stress-churn.ts 100 10 500
 */

import {
  DEFAULT_CONFIG,
  StressConfig,
  createClient,
  disconnectClient,
  getServerStatus,
  getConnectedClients,
  sleep,
} from './helpers.js';

interface ChurnMetrics {
  totalAttempts: number;
  successfulConnections: number;
  failedConnections: number;
  avgConnectTimeMs: number;
  maxConnectTimeMs: number;
  avgSessionDurationMs: number;
  peakConcurrent: number;
  elapsedMs: number;
}

async function stressChurn(
  totalConnections: number,
  concurrency: number,
  holdTimeMs: number,
  config: StressConfig
): Promise<void> {
  const connectTimes: number[] = [];
  let successfulConnections = 0;
  let failedConnections = 0;
  let currentConcurrent = 0;
  let peakConcurrent = 0;
  const startTime = Date.now();

  console.log(`\n🔥 Stress Test: Connection Churn`);
  console.log(`   Total connections: ${totalConnections}`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Hold time per connection: ${holdTimeMs}ms`);
  console.log(`   Endpoint: ${config.endpoint}\n`);

  // Semaphore-style concurrency control
  let active = 0;
  let completed = 0;

  const runOneConnection = async (idx: number): Promise<void> => {
    try {
      const connectStart = Date.now();
      const { client, session } = await createClient(config);
      const connectTime = Date.now() - connectStart;
      connectTimes.push(connectTime);

      currentConcurrent++;
      if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;
      successfulConnections++;

      // Hold the connection briefly
      await sleep(holdTimeMs + Math.random() * holdTimeMs);

      currentConcurrent--;
      await disconnectClient(client, session);
    } catch {
      failedConnections++;
    }

    completed++;
    if (completed % 10 === 0) {
      console.log(`   Progress: ${completed}/${totalConnections} (${successfulConnections} ok, ${failedConnections} failed)`);
    }
  };

  // Run with limited concurrency
  const queue: Promise<void>[] = [];
  for (let i = 0; i < totalConnections; i++) {
    const p = runOneConnection(i);
    queue.push(p);

    if (queue.length >= concurrency) {
      await Promise.race(queue);
      // Remove completed promises
      for (let j = queue.length - 1; j >= 0; j--) {
        const settled = await Promise.race([queue[j].then(() => true), Promise.resolve(false)]);
        if (settled) queue.splice(j, 1);
      }
    }
  }
  await Promise.all(queue);

  // Final dashboard check
  await sleep(2000);
  const status = await getServerStatus();
  const sessions = await getConnectedClients();

  const avgConnect = connectTimes.length > 0
    ? connectTimes.reduce((a, b) => a + b, 0) / connectTimes.length
    : 0;
  const maxConnect = connectTimes.length > 0 ? Math.max(...connectTimes) : 0;

  const elapsedMs = Date.now() - startTime;

  // Report
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Connection Churn Results');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Duration:               ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  Total attempts:         ${totalConnections}`);
  console.log(`  Successful:             ${successfulConnections}`);
  console.log(`  Failed:                 ${failedConnections}`);
  console.log(`  Peak concurrent:        ${peakConcurrent}`);
  console.log(`  Avg connect time:       ${avgConnect.toFixed(1)}ms`);
  console.log(`  Max connect time:       ${maxConnect.toFixed(1)}ms`);
  console.log(`  Connections/sec:        ${(successfulConnections / (elapsedMs / 1000)).toFixed(1)}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Final server state:     ${status.state}`);
  console.log(`  Remaining sessions:     ${sessions.length} (should be 0)`);
  console.log(`${'═'.repeat(60)}\n`);

  if (sessions.length === 0 && failedConnections === 0) {
    console.log('✅ CHURN TEST PASSED — all sessions cleaned up, no failures');
  } else if (sessions.length > 0) {
    console.log('⚠️  WARNING: Sessions not fully cleaned up (may need time)');
  }
  if (failedConnections > 0) {
    console.log(`⚠️  ${failedConnections} connection attempts failed`);
  }
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const totalConnections = parseInt(process.argv[2] || '50', 10);
const concurrency = parseInt(process.argv[3] || '10', 10);
const holdTimeMs = parseInt(process.argv[4] || '500', 10);

stressChurn(totalConnections, concurrency, holdTimeMs, DEFAULT_CONFIG).catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});

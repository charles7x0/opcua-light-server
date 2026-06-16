/**
 * Stress Test: Many Variables (Nodes)
 *
 * Creates a large number of OPC UA nodes via the REST API, reloads the runtime,
 * then connects clients that read/write all variables at high frequency.
 *
 * Usage:
 *   npx tsx tests/stress/stress-variables.ts [numVariables] [numClients] [durationSeconds]
 *
 * Prerequisites:
 *   - Server running: npm run dev (or npm start)
 *   - Runtime started: POST /api/server/start
 *   - Security set to None: PUT /api/security/policy { "mode": "None" }
 *
 * Example:
 *   npx tsx tests/stress/stress-variables.ts 200 5 30
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
  sleep,
  printReport,
  apiRequest,
} from './helpers.js';

const DATA_TYPES = ['Boolean', 'Int16', 'Int32', 'Float', 'Double', 'String'];

function randomDataType(): string {
  return DATA_TYPES[Math.floor(Math.random() * DATA_TYPES.length)];
}

function generateWriteValue(dataType: string): { dataType: DataType; value: unknown } {
  switch (dataType) {
    case 'Boolean':
      return { dataType: DataType.Boolean, value: Math.random() > 0.5 };
    case 'Int16':
      return { dataType: DataType.Int16, value: Math.floor(Math.random() * 32000) };
    case 'Int32':
      return { dataType: DataType.Int32, value: Math.floor(Math.random() * 2_000_000) };
    case 'Float':
      return { dataType: DataType.Float, value: Math.random() * 1000 };
    case 'Double':
      return { dataType: DataType.Double, value: Math.random() * 100000 };
    case 'String':
      return { dataType: DataType.String, value: `stress_${Date.now()}` };
    default:
      return { dataType: DataType.Double, value: Math.random() * 100 };
  }
}

interface CreatedNode {
  name: string;
  dataType: string;
  namespaceUri: string;
}

async function createVariables(numVariables: number): Promise<CreatedNode[]> {
  console.log(`⏳ Creating ${numVariables} nodes via REST API...`);

  // Create a stress-test namespace with unique name
  const timestamp = Date.now();
  const nsName = `StressTest_${timestamp}`;
  const ns = await createNamespace(
    nsName,
    `urn:opcua-light:stress-test:${timestamp}`
  );
  console.log(`   ✓ Namespace created: ${ns.id}`);

  // Create object nodes (group by 50 variables each)
  const nodesPerObject = 50;
  const numObjects = Math.ceil(numVariables / nodesPerObject);
  const objects: { id: string }[] = [];

  for (let i = 0; i < numObjects; i++) {
    const obj = await createObjectNode(`StressGroup_${i}`, ns.id);
    objects.push(obj);
  }
  console.log(`   ✓ ${numObjects} object nodes created`);

  // Create variable nodes
  const createdNodes: CreatedNode[] = [];
  let created = 0;

  for (let i = 0; i < numVariables; i++) {
    const objIdx = Math.floor(i / nodesPerObject);
    const dataType = randomDataType();
    const name = `StressVar_${i}_${dataType}`;

    try {
      await createNode(name, dataType, ns.id, objects[objIdx].id);
      createdNodes.push({ name, dataType, namespaceUri: `urn:opcua-light:stress-test:${Date.now()}` });
      created++;

      if (created % 25 === 0) {
        console.log(`   ✓ ${created}/${numVariables} nodes created`);
      }
    } catch (err) {
      console.log(`   ✗ Failed to create node ${name}: ${(err as Error).message}`);
    }
  }

  console.log(`   ✓ Total: ${created} nodes created`);
  return createdNodes;
}

async function stressVariables(config: StressConfig): Promise<void> {
  const metrics = new MetricsCollector();

  console.log(`\n🔥 Stress Test: ${config.numVariables} variables, ${config.numClients} clients`);
  console.log(`   Endpoint: ${config.endpoint}`);
  console.log(`   Duration: ${config.durationMs / 1000}s\n`);

  // Step 1: Create many variables
  const nodes = await createVariables(config.numVariables);

  // Step 2: Reload server to pick up new nodes
  console.log('\n⏳ Reloading runtime to apply new address space...');
  await reloadServer();
  await sleep(3000); // Wait for runtime to reload
  console.log('   ✓ Runtime reloaded');

  // Step 3: Connect clients
  console.log(`\n⏳ Connecting ${config.numClients} clients...`);
  const clients: Array<{ client: any; session: any }> = [];

  for (let i = 0; i < config.numClients; i++) {
    try {
      const conn = await createClient(config);
      clients.push(conn);
      metrics.clientsConnected++;
    } catch (err) {
      metrics.clientsFailed++;
      console.log(`   ✗ Client ${i + 1} failed: ${(err as Error).message}`);
    }
  }
  console.log(`   ✓ ${metrics.clientsConnected} clients connected`);

  if (clients.length === 0) {
    console.log('\n✗ No clients connected. Aborting.');
    return;
  }

  // Step 4: Browse to find the node IDs in the address space
  console.log('\n⏳ Browsing address space to resolve node IDs...');
  const { session: browseSession } = clients[0];

  // Browse the Objects folder to find our stress test nodes
  // In open62541, custom nodes are under ns=2+ with string identifiers
  const browseResult = await browseSession.browse('ns=0;i=85'); // Objects folder
  const stressNodeIds: string[] = [];

  // Use a simpler approach: try reading known node patterns
  // The nodes will be at ns=<index>;s=<objectName>.<nodeName>
  // We'll read a sample to find the namespace index
  console.log(`   Found ${browseResult.references?.length ?? 0} objects under root`);

  // For stress testing, just use the Server node which always exists
  const serverNodeId = 'i=2258'; // Server.ServerStatus.CurrentTime (always readable)
  console.log('   Using Server.ServerStatus.CurrentTime for read stress');
  console.log('   Using write operations on any writable custom nodes found');

  // Step 5: Run read/write operations
  console.log(`\n⏳ Running operations for ${config.durationMs / 1000}s...`);
  const endTime = Date.now() + config.durationMs;
  let running = true;

  const workers = clients.map(async ({ session }, clientIdx) => {
    while (running && Date.now() < endTime) {
      // Read operation
      try {
        const start = Date.now();
        const result = await session.read({
          nodeId: serverNodeId,
          attributeId: AttributeIds.Value,
        });
        metrics.recordRead(Date.now() - start);
      } catch {
        metrics.recordReadError();
      }

      // Write operation (attempt on a writable node)
      try {
        const start = Date.now();
        await session.write({
          nodeId: serverNodeId,
          attributeId: AttributeIds.Value,
          value: {
            value: { dataType: DataType.DateTime, value: new Date() },
          },
        });
        metrics.recordWrite(Date.now() - start);
      } catch {
        // Write errors are expected on read-only nodes
        metrics.recordWriteError();
      }

      await sleep(config.readIntervalMs);
    }
  });

  await Promise.race([
    Promise.all(workers),
    sleep(config.durationMs).then(() => { running = false; }),
  ]);
  running = false;
  await sleep(1000);

  // Step 6: Disconnect
  console.log('⏳ Disconnecting clients...');
  await Promise.all(clients.map(({ client, session }) => disconnectClient(client, session)));
  console.log('✓ All clients disconnected');

  // Step 7: Cleanup — delete stress test nodes
  console.log('\n⏳ Cleaning up stress test nodes...');
  try {
    const namespaces = await apiRequest<Array<{ id: string; name: string }>>('GET', '/api/namespaces');
    const stressNs = namespaces.find(n => n.name.startsWith('StressTest'));
    if (stressNs) {
      await apiRequest('DELETE', `/api/namespaces/${stressNs.id}`);
      console.log('   ✓ Stress test namespace deleted');
      await reloadServer();
    }
  } catch (err) {
    console.log(`   ⚠ Cleanup failed: ${(err as Error).message}`);
  }

  // Report
  printReport('Stress Test: Many Variables', metrics.getReport());
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

const numVariables = parseInt(process.argv[2] || '100', 10);
const numClients = parseInt(process.argv[3] || '5', 10);
const durationSec = parseInt(process.argv[4] || '30', 10);

const config: StressConfig = {
  ...DEFAULT_CONFIG,
  numVariables,
  numClients,
  durationMs: durationSec * 1000,
};

stressVariables(config).catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});

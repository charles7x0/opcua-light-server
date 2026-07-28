/**
 * Integration test for EtherNet/IP tag reading against a live PLC (localhost).
 * Run with: npx vitest run tests/integration/ethernet-ip-live.test.ts
 *
 * Prerequisites: PLC or simulator running on localhost:44818
 * Automatically skipped when no PLC is reachable.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { PLC } from 'ethernet-ip';
import type { PLCConnectOptions } from 'ethernet-ip';
import { createConnection } from 'net';

const PLC_HOST = 'localhost';
const PLC_PORT = 44818;
const PLC_SLOT = 0;

// Tags to test (from the Node-RED config)
const TEST_TAGS = [
  'HMI_Stats_Rejects',
  'AnalogOut_CH1',
  'AnalogOut_CH0',
  'HMI_Stats_MachineTotalUnits',
];

/** Check if a PLC is reachable on the expected host/port */
const isPLCReachable = await new Promise<boolean>((resolve) => {
  const socket = createConnection({ host: PLC_HOST, port: PLC_PORT, timeout: 1000 });
  socket.on('connect', () => { socket.destroy(); resolve(true); });
  socket.on('error', () => { socket.destroy(); resolve(false); });
  socket.on('timeout', () => { socket.destroy(); resolve(false); });
});

describe.skipIf(!isPLCReachable)('EtherNet/IP Live PLC Read (Connected Mode)', () => {
  let plc: PLC;

  afterAll(async () => {
    try {
      await plc?.disconnect();
    } catch { /* ignore */ }
  });

  it('should connect with ForwardOpen (connected: true, discover: true)', async () => {
    plc = new PLC();
    const options: PLCConnectOptions = {
      slot: PLC_SLOT,
      connected: true,
      discover: true,
      autoReconnect: false,
    };

    await plc.connect(PLC_HOST, options);
    expect(plc.isConnected).toBe(true);
    console.log('✓ Connected to PLC (ForwardOpen + auto-discover)');
  });

  it('should list discovered tags from registry', () => {
    const registry = plc.registry;
    const entries = registry.entries();
    console.log(`✓ Registry has ${entries.length} tag(s)`);
    entries.slice(0, 15).forEach((e) => {
      console.log(`    - ${e.name} (type: ${e.type})`);
    });
    expect(entries.length).toBeGreaterThan(0);
  });

  it('should read HMI_Stats_Rejects (DINT)', async () => {
    const value = await plc.read('HMI_Stats_Rejects');
    console.log(`✓ HMI_Stats_Rejects = ${JSON.stringify(value)} (type: ${typeof value})`);
    expect(value).toBeDefined();
  });

  it('should read AnalogOut_CH1 (INT)', async () => {
    const value = await plc.read('AnalogOut_CH1');
    console.log(`✓ AnalogOut_CH1 = ${JSON.stringify(value)} (type: ${typeof value})`);
    expect(value).toBeDefined();
  });

  it('should read AnalogOut_CH0 (INT)', async () => {
    const value = await plc.read('AnalogOut_CH0');
    console.log(`✓ AnalogOut_CH0 = ${JSON.stringify(value)} (type: ${typeof value})`);
    expect(value).toBeDefined();
  });

  it('should read HMI_Stats_MachineTotalUnits (INT)', async () => {
    const value = await plc.read('HMI_Stats_MachineTotalUnits');
    console.log(`✓ HMI_Stats_MachineTotalUnits = ${JSON.stringify(value)} (type: ${typeof value})`);
    expect(value).toBeDefined();
  });

  it('should batch read all tags', async () => {
    const values = await plc.read(TEST_TAGS);
    console.log('✓ Batch read:');
    TEST_TAGS.forEach((tag, i) => {
      console.log(`    ${tag} = ${JSON.stringify(values[i])}`);
    });
    expect(values).toHaveLength(TEST_TAGS.length);
  });

  it('should read multiple times without timeout (simulating polling)', async () => {
    for (let i = 0; i < 5; i++) {
      const value = await plc.read('HMI_Stats_Rejects');
      console.log(`  Poll ${i + 1}: HMI_Stats_Rejects = ${value}`);
      await new Promise((r) => setTimeout(r, 1000)); // 1s interval
    }
  }, 10000);
});

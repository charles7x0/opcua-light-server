/**
 * Benchmark Wrapper — Resource Monitor
 *
 * Monitors CPU and memory usage of both the Node.js Control API and the
 * C runtime (opcua-runtime.exe) while a stress test runs as a child process.
 *
 * Usage:
 *   npx tsx tests/stress/benchmark.ts <stress-script> [args...]
 *
 * Examples:
 *   npx tsx tests/stress/benchmark.ts tests/stress/stress-clients.ts 20 30
 *   npx tsx tests/stress/benchmark.ts tests/stress/stress-combined.ts 10 100 60
 *
 * Or use the npm script:
 *   npm run stress:benchmark -- tests/stress/stress-clients.ts 20 30
 *
 * Output:
 *   - Real-time resource sampling every second
 *   - Summary report with min/max/avg for CPU% and memory (RSS)
 *   - Optional CSV export with --csv flag
 */

import { spawn } from 'child_process';
import pidusage from 'pidusage';
import { writeFileSync } from 'fs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProcessSample {
  timestamp: number;
  cpu: number;      // percentage (0-100+)
  memory: number;   // bytes (RSS)
}

interface ProcessProfile {
  name: string;
  pid: number;
  samples: ProcessSample[];
}

interface BenchmarkReport {
  process: string;
  pid: number;
  sampleCount: number;
  cpu: { min: number; max: number; avg: number };
  memoryMB: { min: number; max: number; avg: number; peak: number };
}

// ─── Process Discovery ────────────────────────────────────────────────────────

async function findProcessPids(): Promise<{ apiPid: number | null; runtimePid: number | null }> {
  // Use the /api/server/status endpoint to get the runtime PID
  let runtimePid: number | null = null;
  let apiPid: number | null = null;

  try {
    const statusRes = await fetch('http://localhost:3100/api/server/status');
    const status = await statusRes.json() as { pid?: number; state: string };
    if (status.pid) {
      runtimePid = status.pid;
    }
  } catch {
    console.log('⚠ Could not reach Control API to get runtime PID');
  }

  // Find the Node.js API process by checking which node process listens on port 3100
  // On Windows, use netstat to find it
  try {
    const { execSync } = await import('child_process');
    const output = execSync('netstat -ano | findstr :3100 | findstr LISTENING', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const match = output.match(/LISTENING\s+(\d+)/);
    if (match) {
      apiPid = parseInt(match[1], 10);
    }
  } catch {
    console.log('⚠ Could not find Control API process via netstat');
  }

  return { apiPid, runtimePid };
}

// ─── Sampling ─────────────────────────────────────────────────────────────────

class ResourceMonitor {
  private profiles: Map<string, ProcessProfile> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sampleIntervalMs: number;

  constructor(sampleIntervalMs = 1000) {
    this.sampleIntervalMs = sampleIntervalMs;
  }

  addProcess(name: string, pid: number): void {
    this.profiles.set(name, { name, pid, samples: [] });
  }

  start(): void {
    this.intervalId = setInterval(() => this.sample(), this.sampleIntervalMs);
    // Take an immediate first sample
    this.sample();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async sample(): Promise<void> {
    const now = Date.now();

    for (const [name, profile] of this.profiles) {
      try {
        const stats = await pidusage(profile.pid);
        profile.samples.push({
          timestamp: now,
          cpu: stats.cpu,
          memory: stats.memory,
        });
      } catch {
        // Process may have exited — skip this sample
      }
    }
  }

  getReports(): BenchmarkReport[] {
    const reports: BenchmarkReport[] = [];

    for (const [name, profile] of this.profiles) {
      if (profile.samples.length === 0) {
        reports.push({
          process: name,
          pid: profile.pid,
          sampleCount: 0,
          cpu: { min: 0, max: 0, avg: 0 },
          memoryMB: { min: 0, max: 0, avg: 0, peak: 0 },
        });
        continue;
      }

      const cpus = profile.samples.map(s => s.cpu);
      const mems = profile.samples.map(s => s.memory);

      const avgCpu = cpus.reduce((a, b) => a + b, 0) / cpus.length;
      const avgMem = mems.reduce((a, b) => a + b, 0) / mems.length;

      reports.push({
        process: name,
        pid: profile.pid,
        sampleCount: profile.samples.length,
        cpu: {
          min: Math.round(Math.min(...cpus) * 10) / 10,
          max: Math.round(Math.max(...cpus) * 10) / 10,
          avg: Math.round(avgCpu * 10) / 10,
        },
        memoryMB: {
          min: Math.round(Math.min(...mems) / 1024 / 1024 * 10) / 10,
          max: Math.round(Math.max(...mems) / 1024 / 1024 * 10) / 10,
          avg: Math.round(avgMem / 1024 / 1024 * 10) / 10,
          peak: Math.round(Math.max(...mems) / 1024 / 1024 * 10) / 10,
        },
      });
    }

    return reports;
  }

  exportCsv(filename: string): void {
    const lines: string[] = ['timestamp,process,pid,cpu_percent,memory_mb'];

    for (const [name, profile] of this.profiles) {
      for (const sample of profile.samples) {
        const memMB = (sample.memory / 1024 / 1024).toFixed(2);
        const cpu = sample.cpu.toFixed(2);
        lines.push(`${sample.timestamp},${name},${profile.pid},${cpu},${memMB}`);
      }
    }

    writeFileSync(filename, lines.join('\n'), 'utf-8');
  }
}

// ─── Report Printing ──────────────────────────────────────────────────────────

function printBenchmarkReport(reports: BenchmarkReport[], elapsedSec: number): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('  BENCHMARK RESULTS — Resource Usage During Stress Test');
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Total duration: ${elapsedSec.toFixed(1)}s\n`);

  for (const r of reports) {
    console.log(`  ┌─ ${r.process} (PID ${r.pid}) — ${r.sampleCount} samples`);
    console.log(`  │  CPU:    min ${r.cpu.min}%  avg ${r.cpu.avg}%  max ${r.cpu.max}%`);
    console.log(`  │  Memory: min ${r.memoryMB.min}MB  avg ${r.memoryMB.avg}MB  peak ${r.memoryMB.peak}MB`);
    console.log(`  └${'─'.repeat(60)}`);
  }

  console.log(`\n${'═'.repeat(70)}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  const csvFlag = args.includes('--csv');
  const filteredArgs = args.filter(a => a !== '--csv');

  if (filteredArgs.length === 0) {
    console.log('Usage: npx tsx tests/stress/benchmark.ts <stress-script.ts> [args...] [--csv]');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx tests/stress/benchmark.ts tests/stress/stress-clients.ts 20 30');
    console.log('  npx tsx tests/stress/benchmark.ts tests/stress/stress-combined.ts 10 100 60 --csv');
    process.exit(1);
  }

  const scriptPath = filteredArgs[0];
  const scriptArgs = filteredArgs.slice(1);

  console.log(`\n📊 Benchmark: Monitoring resource usage`);
  console.log(`   Script: ${scriptPath} ${scriptArgs.join(' ')}`);
  console.log(`   Sampling: every 1 second`);
  if (csvFlag) console.log(`   CSV export: enabled`);

  // Discover processes
  console.log('\n⏳ Discovering processes...');
  const { apiPid, runtimePid } = await findProcessPids();

  const monitor = new ResourceMonitor(1000);

  if (apiPid) {
    monitor.addProcess('Control API (Node.js)', apiPid);
    console.log(`   ✓ Control API: PID ${apiPid}`);
  } else {
    console.log('   ✗ Control API not found (is it running on port 3100?)');
  }

  if (runtimePid) {
    monitor.addProcess('OPC UA Runtime (C)', runtimePid);
    console.log(`   ✓ OPC UA Runtime: PID ${runtimePid}`);
  } else {
    console.log('   ✗ OPC UA Runtime not found (is the server started?)');
  }

  if (!apiPid && !runtimePid) {
    console.log('\n✗ No processes found to monitor. Ensure the server is running.');
    process.exit(1);
  }

  // Start monitoring
  console.log('\n⏳ Starting resource monitor...');
  monitor.start();
  const startTime = Date.now();

  // Spawn the stress test as a child process
  console.log(`⏳ Launching stress test: ${scriptPath}\n`);
  console.log('─'.repeat(70));

  const child = spawn('npx', ['tsx', scriptPath, ...scriptArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
  });

  // Wait for child to exit
  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      console.error(`Failed to start stress test: ${err.message}`);
      resolve(1);
    });
  });

  console.log('─'.repeat(70));

  // Stop monitoring
  monitor.stop();
  const elapsedSec = (Date.now() - startTime) / 1000;

  // Generate report
  const reports = monitor.getReports();
  printBenchmarkReport(reports, elapsedSec);

  // CSV export
  if (csvFlag) {
    const csvFile = `benchmark_${Date.now()}.csv`;
    monitor.exportCsv(csvFile);
    console.log(`📄 CSV exported to: ${csvFile}\n`);
  }

  // Exit with the same code as the stress test
  process.exit(exitCode);
}

main();

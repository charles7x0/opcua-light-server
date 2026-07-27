import { spawn, type ChildProcess } from 'child_process';
import { platform } from 'os';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ClientSession, ServerStatus, StartResult } from '../types/index.js';
import { validateSessions } from './validate-sessions.js';
import type { SseHub } from '../api/sse-hub.js';

/**
 * ProcessManager handles the lifecycle of the open62541 OPC UA runtime process.
 * It spawns, monitors, stops, and reloads the C runtime as a child process.
 */
export class ProcessManager {
  private process: ChildProcess | null = null;
  private state: ServerStatus['state'] = 'stopped';
  private startedAt: Date | null = null;
  private lastError: string | undefined = undefined;
  private connectedClients = 0;
  private stopping = false;
  private crashHandlers: Array<(reason: string) => void> = [];
  private stderrBuffer = '';
  private sseHub: SseHub | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private previousSessionsJson = '[]';

  /**
   * @param executablePath - Path to the compiled open62541 runtime binary.
   * @param configFilePath - Path to the JSON configuration file the runtime reads.
   */
  constructor(
    private readonly executablePath: string,
    private readonly configFilePath: string
  ) {}

  /**
   * Set the SseHub instance for broadcasting real-time events.
   * Optional — ProcessManager works fine without an SseHub (backward compatibility).
   */
  setSseHub(hub: SseHub): void {
    this.sseHub = hub;
  }

  /**
   * Start the open62541 runtime process.
   * Spawns the executable with the config file path as an argument.
   */
  async start(): Promise<StartResult> {
    if (this.state === 'running' && this.process) {
      throw new Error('Process is already running');
    }

    this.stopping = false;
    this.lastError = undefined;
    this.stderrBuffer = '';

    const child = spawn(this.executablePath, [this.configFilePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!child.pid) {
      this.state = 'error';
      this.lastError = 'Failed to spawn process: no PID assigned';
      throw new Error(this.lastError);
    }

    this.process = child;
    this.state = 'running';
    this.startedAt = new Date();
    this.connectedClients = 0;

    this.attachEventListeners(child);

    this.broadcastStatus();
    this.startStatusTimer();

    return {
      pid: child.pid,
      startedAt: this.startedAt,
    };
  }

  /**
   * Gracefully stop the runtime process.
   * Sends SIGTERM on Linux/Mac or uses taskkill on Windows.
   */
  async stop(): Promise<void> {
    if (this.state !== 'running' || !this.process) {
      throw new Error('Process is not running');
    }

    this.stopping = true;

    return new Promise<void>((resolve, reject) => {
      const child = this.process!;
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long (10 seconds)
        child.kill('SIGKILL');
      }, 10_000);

      child.once('exit', () => {
        clearTimeout(timeout);
        this.cleanup();
        this.broadcastStatus();
        this.broadcastClients([]);
        resolve();
      });

      child.once('error', (err) => {
        clearTimeout(timeout);
        this.cleanup();
        reject(err);
      });

      if (platform() === 'win32') {
        // On Windows, use taskkill for graceful termination
        spawn('taskkill', ['/pid', String(child.pid), '/t'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    });
  }

  /**
   * Reload the runtime configuration without a full restart.
   * Sends SIGUSR1 on Linux/Mac or writes to a named pipe on Windows.
   */
  async reload(): Promise<void> {
    if (this.state !== 'running' || !this.process || !this.process.pid) {
      throw new Error('Process is not running');
    }

    if (platform() === 'win32') {
      // Windows: write a reload signal to a named pipe
      // The pipe name is based on the process PID
      this.sendWindowsReloadSignal(this.process.pid);
    } else {
      // Linux/Mac: send SIGUSR1 signal
      process.kill(this.process.pid, 'SIGUSR1');
    }

    this.broadcastStatus();
  }

  /**
   * Get the current server status including state, uptime, pid, and connected clients.
   */
  getStatus(): ServerStatus {
    const status: ServerStatus = {
      state: this.state,
    };

    if (this.state === 'running' && this.startedAt) {
      status.uptime = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
      status.pid = this.process?.pid;
      status.connectedClients = this.readConnectedClients();
    }

    if (this.lastError) {
      status.lastError = this.lastError;
    }

    return status;
  }

  /**
   * Read connected client count from the runtime's status.json file.
   */
  private readConnectedClients(): number {
    try {
      const statusPath = join(dirname(this.configFilePath), 'status.json');
      if (!existsSync(statusPath)) return 0;
      const content = readFileSync(statusPath, 'utf-8');
      const data = JSON.parse(content);
      return typeof data.connectedClients === 'number' ? data.connectedClients : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Read client sessions from the runtime's status.json file.
   * Returns validated session objects or an empty array if the runtime
   * is not running, the file is missing, or the data is invalid.
   */
  readClientSessions(): ClientSession[] {
    if (this.state !== 'running') {
      return [];
    }

    try {
      const statusPath = join(dirname(this.configFilePath), 'status.json');
      if (!existsSync(statusPath)) return [];
      const content = readFileSync(statusPath, 'utf-8');
      const data = JSON.parse(content);
      return validateSessions(data.sessions);
    } catch {
      return [];
    }
  }

  /**
   * Register a callback that fires when the runtime process crashes unexpectedly.
   */
  onCrash(handler: (reason: string) => void): void {
    this.crashHandlers.push(handler);
  }

  /**
   * Update the connected client count.
   * Can be called externally when client count information is available
   * (e.g., parsed from stdout or received via IPC).
   */
  updateConnectedClients(count: number): void {
    this.connectedClients = count;
  }

  /**
   * Write data to the runtime process's stdin pipe.
   * Used by the S7 Connector to send value updates to the runtime.
   * Returns true if the write was accepted, false if the pipe is unavailable.
   * Throws if the process is not running.
   */
  writeToStdin(data: string): boolean {
    if (this.state !== 'running' || !this.process) {
      throw new Error('Process is not running');
    }

    if (!this.process.stdin || this.process.stdin.destroyed || !this.process.stdin.writable) {
      return false;
    }

    return this.process.stdin.write(data);
  }

  /**
   * Attach exit and error event listeners to the child process.
   */
  private attachEventListeners(child: ChildProcess): void {
    child.on('exit', (code, signal) => {
      if (!this.stopping) {
        // Unexpected exit — this is a crash
        let reason = signal
          ? `Process killed by signal: ${signal}`
          : `Process exited with code: ${code}`;

        // Append stderr output if available for better diagnostics
        if (this.stderrBuffer.trim()) {
          reason += `\nstderr: ${this.stderrBuffer.trim()}`;
        }

        this.state = 'error';
        this.lastError = reason;
        this.process = null;

        for (const handler of this.crashHandlers) {
          try {
            handler(reason);
          } catch {
            // Don't let a failing handler break the loop
          }
        }
      }
    });

    child.on('error', (err) => {
      if (!this.stopping) {
        const reason = `Process error: ${err.message}`;
        this.state = 'error';
        this.lastError = reason;
        this.process = null;

        for (const handler of this.crashHandlers) {
          try {
            handler(reason);
          } catch {
            // Don't let a failing handler break the loop
          }
        }
      }
    });

    // Absorb write errors on stdin (EPIPE when runtime has exited).
    // Without this handler, the 'error' event would be unhandled and crash Node.
    if (child.stdin) {
      child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        // EPIPE is expected when the runtime process exits while we still
        // have a reference — it's handled via the 'exit' listener above.
        if (err.code !== 'EPIPE') {
          this.lastError = `stdin error: ${err.message}`;
        }
      });
    }

    // Parse stdout for potential client connection info
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        this.parseStdout(data.toString());
      });
    }

    // Capture stderr so crash diagnostics are visible in the crash reason
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          this.stderrBuffer += text + '\n';
        }
      });
    }
  }

  /**
   * Parse stdout output from the runtime for client connection information.
   * The runtime may output lines like "clients:N" to report connected client count.
   */
  private parseStdout(output: string): void {
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/^clients:(\d+)$/);
      if (match) {
        this.connectedClients = parseInt(match[1], 10);
      }
    }
  }

  /**
   * Send a reload signal on Windows via a named pipe.
   * The convention is to write "reload" to \\.\pipe\opcua-runtime-{pid}.
   */
  private sendWindowsReloadSignal(pid: number): void {
    const pipePath = `\\\\.\\pipe\\opcua-runtime-${pid}`;
    try {
      writeFileSync(pipePath, 'reload');
    } catch (err) {
      throw new Error(
        `Failed to send reload signal via named pipe ${pipePath}: ${(err as Error).message}`
      );
    }
  }

  /**
   * Clean up internal state after the process has stopped.
   */
  private cleanup(): void {
    this.stopStatusTimer();
    this.state = 'stopped';
    this.process = null;
    this.startedAt = null;
    this.connectedClients = 0;
    this.stopping = false;
    this.stderrBuffer = '';
    this.previousSessionsJson = '[]';
  }

  /**
   * Broadcast the current server status via SSE.
   */
  private broadcastStatus(): void {
    if (!this.sseHub) return;
    this.sseHub.broadcast('server:status', this.getStatus());
  }

  /**
   * Broadcast client sessions via SSE.
   */
  private broadcastClients(sessions: ClientSession[]): void {
    if (!this.sseHub) return;
    this.sseHub.broadcast('server:clients', sessions);
  }

  /**
   * Start the periodic status timer (every 5 seconds).
   * Broadcasts server:status and checks for client session changes.
   */
  private startStatusTimer(): void {
    if (this.statusTimer) return;

    this.statusTimer = setInterval(() => {
      this.broadcastStatus();

      // Check for client session changes
      const sessions = this.readClientSessions();
      const sessionsJson = JSON.stringify(sessions);
      if (sessionsJson !== this.previousSessionsJson) {
        this.previousSessionsJson = sessionsJson;
        this.broadcastClients(sessions);
      }
    }, 5_000);
  }

  /**
   * Stop the periodic status timer.
   */
  private stopStatusTimer(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }
}

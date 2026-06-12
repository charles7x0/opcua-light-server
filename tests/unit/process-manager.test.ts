import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  platform: vi.fn(() => 'linux'),
}));

// Mock fs module
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '{"connectedClients":0}'),
  existsSync: vi.fn(() => true),
}));

import { spawn } from 'child_process';
import { platform } from 'os';
import { writeFileSync } from 'fs';
import { ProcessManager } from '../../src/process-manager/index.js';

/**
 * Creates a mock ChildProcess with EventEmitter capabilities and mock streams.
 */
function createMockChildProcess(pid: number = 1234): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  (child as any).pid = pid;
  (child as any).kill = vi.fn(() => true);
  const stdin = new EventEmitter() as any;
  stdin.writable = true;
  stdin.destroyed = false;
  stdin.write = vi.fn(() => true);
  (child as any).stdin = stdin;
  (child as any).stdout = new EventEmitter();
  (child as any).stderr = new EventEmitter();
  return child;
}

describe('ProcessManager', () => {
  let pm: ProcessManager;
  const executablePath = '/usr/local/bin/opcua-runtime';
  const configFilePath = '/etc/opcua/config.json';

  beforeEach(() => {
    vi.clearAllMocks();
    pm = new ProcessManager(executablePath, configFilePath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start', () => {
    it('should spawn the executable with the config file path as argument', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      expect(spawn).toHaveBeenCalledWith(
        executablePath,
        [configFilePath],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
    });

    it('should return the pid and startedAt on successful start', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const result = await pm.start();

      expect(result.pid).toBe(5678);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('should set status to running after start', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      const status = pm.getStatus();
      expect(status.state).toBe('running');
      expect(status.pid).toBe(5678);
    });

    it('should throw if process is already running', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      await expect(pm.start()).rejects.toThrow('Process is already running');
    });

    it('should throw and set error state if spawn returns no PID', async () => {
      const mockChild = createMockChildProcess(0);
      (mockChild as any).pid = undefined;
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await expect(pm.start()).rejects.toThrow('Failed to spawn process: no PID assigned');

      const status = pm.getStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('Failed to spawn process: no PID assigned');
    });
  });

  describe('stop', () => {
    it('should throw if process is not running', async () => {
      await expect(pm.stop()).rejects.toThrow('Process is not running');
    });

    it('should send SIGTERM on Linux/Mac', async () => {
      vi.mocked(platform).mockReturnValue('linux');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      const stopPromise = pm.stop();

      // Simulate process exit
      mockChild.emit('exit', 0, null);

      await stopPromise;

      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should use taskkill on Windows', async () => {
      vi.mocked(platform).mockReturnValue('win32');
      const mockChild = createMockChildProcess(5678);
      const taskkillChild = createMockChildProcess(9999);
      vi.mocked(spawn)
        .mockReturnValueOnce(mockChild as any)   // start()
        .mockReturnValueOnce(taskkillChild as any); // taskkill call in stop()

      await pm.start();

      const stopPromise = pm.stop();

      // Simulate process exit
      mockChild.emit('exit', 0, null);

      await stopPromise;

      // Verify taskkill was called with the correct PID
      expect(spawn).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '5678', '/t'],
        { stdio: 'ignore' }
      );
    });

    it('should set status to stopped after successful stop', async () => {
      vi.mocked(platform).mockReturnValue('linux');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      const stopPromise = pm.stop();
      mockChild.emit('exit', 0, null);
      await stopPromise;

      const status = pm.getStatus();
      expect(status.state).toBe('stopped');
      expect(status.pid).toBeUndefined();
      expect(status.uptime).toBeUndefined();
    });

    it('should force kill with SIGKILL after 10 second timeout', async () => {
      vi.useFakeTimers();
      vi.mocked(platform).mockReturnValue('linux');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      const stopPromise = pm.stop();

      // Advance time past the 10-second timeout
      vi.advanceTimersByTime(10_000);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');

      // Now simulate exit after force kill
      mockChild.emit('exit', null, 'SIGKILL');
      await stopPromise;

      vi.useRealTimers();
    });
  });

  describe('reload', () => {
    it('should throw if process is not running', async () => {
      await expect(pm.reload()).rejects.toThrow('Process is not running');
    });

    it('should send SIGUSR1 on Linux/Mac', async () => {
      vi.mocked(platform).mockReturnValue('linux');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      // Mock process.kill for sending signals
      const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      await pm.start();
      await pm.reload();

      expect(processKillSpy).toHaveBeenCalledWith(5678, 'SIGUSR1');

      processKillSpy.mockRestore();
    });

    it('should write to named pipe on Windows', async () => {
      vi.mocked(platform).mockReturnValue('win32');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();
      await pm.reload();

      expect(writeFileSync).toHaveBeenCalledWith(
        '\\\\.\\pipe\\opcua-runtime-5678',
        'reload'
      );
    });

    it('should throw if Windows named pipe write fails', async () => {
      vi.mocked(platform).mockReturnValue('win32');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('Pipe not found');
      });

      await pm.start();

      await expect(pm.reload()).rejects.toThrow(
        'Failed to send reload signal via named pipe'
      );
    });
  });

  describe('crash detection and status transitions', () => {
    it('should set status to error on unexpected exit with code', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate unexpected crash
      mockChild.emit('exit', 1, null);

      const status = pm.getStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('Process exited with code: 1');
    });

    it('should set status to error on unexpected exit with signal', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate being killed by signal
      mockChild.emit('exit', null, 'SIGSEGV');

      const status = pm.getStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('Process killed by signal: SIGSEGV');
    });

    it('should set status to error on process error event', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate process error
      mockChild.emit('error', new Error('ENOENT: file not found'));

      const status = pm.getStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('Process error: ENOENT: file not found');
    });

    it('should invoke crash handlers on unexpected exit', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const crashHandler = vi.fn();
      pm.onCrash(crashHandler);

      await pm.start();

      mockChild.emit('exit', 137, null);

      expect(crashHandler).toHaveBeenCalledWith('Process exited with code: 137');
    });

    it('should invoke crash handlers on process error', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const crashHandler = vi.fn();
      pm.onCrash(crashHandler);

      await pm.start();

      mockChild.emit('error', new Error('spawn EACCES'));

      expect(crashHandler).toHaveBeenCalledWith('Process error: spawn EACCES');
    });

    it('should invoke multiple crash handlers', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      pm.onCrash(handler1);
      pm.onCrash(handler2);

      await pm.start();

      mockChild.emit('exit', 1, null);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should not invoke crash handlers on intentional stop', async () => {
      vi.mocked(platform).mockReturnValue('linux');
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const crashHandler = vi.fn();
      pm.onCrash(crashHandler);

      await pm.start();

      const stopPromise = pm.stop();
      mockChild.emit('exit', 0, null);
      await stopPromise;

      expect(crashHandler).not.toHaveBeenCalled();
    });

    it('should not break if a crash handler throws', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const throwingHandler = vi.fn(() => { throw new Error('handler error'); });
      const normalHandler = vi.fn();
      pm.onCrash(throwingHandler);
      pm.onCrash(normalHandler);

      await pm.start();

      mockChild.emit('exit', 1, null);

      expect(throwingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return stopped state initially', () => {
      const status = pm.getStatus();
      expect(status.state).toBe('stopped');
      expect(status.uptime).toBeUndefined();
      expect(status.pid).toBeUndefined();
      expect(status.connectedClients).toBeUndefined();
    });

    it('should return running state with uptime and pid after start', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      const status = pm.getStatus();
      expect(status.state).toBe('running');
      expect(status.pid).toBe(5678);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.connectedClients).toBe(0);
    });

    it('should include lastError when in error state', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();
      mockChild.emit('exit', 1, null);

      const status = pm.getStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBeDefined();
    });

    it('should track connected clients from status file', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Mock the status file to report 3 clients
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue('{"connectedClients":3}');

      const status = pm.getStatus();
      expect(status.connectedClients).toBe(3);
    });

    it('should return 0 clients when status file does not exist', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Mock status file not existing
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const status = pm.getStatus();
      expect(status.connectedClients).toBe(0);
    });
  });

  describe('writeToStdin', () => {
    it('should throw if process is not running', () => {
      expect(() => pm.writeToStdin('test')).toThrow('Process is not running');
    });

    it('should write data to stdin when process is running', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      const result = pm.writeToStdin('hello\n');

      expect(mockChild.stdin!.write).toHaveBeenCalledWith('hello\n');
      expect(result).toBe(true);
    });

    it('should return false when stdin is destroyed', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate stdin being destroyed (e.g., process exiting)
      (mockChild.stdin as any).destroyed = true;

      const result = pm.writeToStdin('hello\n');

      expect(result).toBe(false);
      expect(mockChild.stdin!.write).not.toHaveBeenCalled();
    });

    it('should return false when stdin is not writable', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate stdin becoming non-writable
      (mockChild.stdin as any).writable = false;

      const result = pm.writeToStdin('hello\n');

      expect(result).toBe(false);
      expect(mockChild.stdin!.write).not.toHaveBeenCalled();
    });

    it('should throw after process has crashed (state is error)', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate crash
      mockChild.emit('exit', 1, null);

      expect(() => pm.writeToStdin('hello\n')).toThrow('Process is not running');
    });
  });

  describe('stdin error handling', () => {
    it('should not crash the process manager on EPIPE error', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate EPIPE error on stdin — this should NOT throw or crash
      const epipeError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      expect(() => {
        (mockChild.stdin as EventEmitter).emit('error', epipeError);
      }).not.toThrow();

      // Status should still be running (crash comes from exit event, not stdin error)
      const status = pm.getStatus();
      expect(status.state).toBe('running');
    });

    it('should record lastError for non-EPIPE stdin errors', async () => {
      const mockChild = createMockChildProcess(5678);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      await pm.start();

      // Simulate a non-EPIPE stdin error
      const otherError = Object.assign(new Error('some stdin error'), { code: 'ECONNRESET' });
      (mockChild.stdin as EventEmitter).emit('error', otherError);

      const status = pm.getStatus();
      expect(status.lastError).toBe('stdin error: some stdin error');
    });
  });
});

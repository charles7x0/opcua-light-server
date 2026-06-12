import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TofuManager } from '../../../src/tofu-manager/index.js';

/**
 * Creates a mock ProcessManager with the minimum interface needed by TofuManager.
 */
function createMockProcessManager() {
  return {
    getStatus: vi.fn().mockReturnValue({ state: 'stopped' }),
    writeToStdin: vi.fn().mockReturnValue(true),
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    onCrash: vi.fn(),
    updateConnectedClients: vi.fn(),
  } as any;
}

describe('TofuManager.signalReload()', () => {
  let processManager: ReturnType<typeof createMockProcessManager>;
  let manager: TofuManager;

  beforeEach(() => {
    processManager = createMockProcessManager();
    manager = new TofuManager('data/pki', processManager);
  });

  it('writes the reload JSON to stdin when runtime is running', () => {
    processManager.getStatus.mockReturnValue({ state: 'running' });

    manager.signalReload();

    expect(processManager.writeToStdin).toHaveBeenCalledWith(
      '{"type":"trust_store_reload"}\n'
    );
  });

  it('does not write to stdin when runtime is stopped', () => {
    processManager.getStatus.mockReturnValue({ state: 'stopped' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    manager.signalReload();

    expect(processManager.writeToStdin).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[TofuManager] Runtime not running, skipping reload signal'
    );

    consoleSpy.mockRestore();
  });

  it('does not write to stdin when runtime is in error state', () => {
    processManager.getStatus.mockReturnValue({ state: 'error' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    manager.signalReload();

    expect(processManager.writeToStdin).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[TofuManager] Runtime not running, skipping reload signal'
    );

    consoleSpy.mockRestore();
  });

  it('logs a warning when writeToStdin returns false', () => {
    processManager.getStatus.mockReturnValue({ state: 'running' });
    processManager.writeToStdin.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manager.signalReload();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[TofuManager] Failed to write reload signal to stdin'
    );

    consoleSpy.mockRestore();
  });

  it('does not log a warning when writeToStdin returns true', () => {
    processManager.getStatus.mockReturnValue({ state: 'running' });
    processManager.writeToStdin.mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manager.signalReload();

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

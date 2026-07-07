import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TofuManager } from '../../../src/tofu-manager/index.js';
import { logService } from '../../../src/log/index.js';

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
    const logSpy = vi.spyOn(logService, 'info').mockImplementation(() => {});

    manager.signalReload();

    expect(processManager.writeToStdin).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'TofuManager',
      'Runtime not running, skipping reload signal'
    );

    logSpy.mockRestore();
  });

  it('does not write to stdin when runtime is in error state', () => {
    processManager.getStatus.mockReturnValue({ state: 'error' });
    const logSpy = vi.spyOn(logService, 'info').mockImplementation(() => {});

    manager.signalReload();

    expect(processManager.writeToStdin).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'TofuManager',
      'Runtime not running, skipping reload signal'
    );

    logSpy.mockRestore();
  });

  it('logs a warning when writeToStdin returns false', () => {
    processManager.getStatus.mockReturnValue({ state: 'running' });
    processManager.writeToStdin.mockReturnValue(false);
    const logSpy = vi.spyOn(logService, 'warn').mockImplementation(() => {});

    manager.signalReload();

    expect(logSpy).toHaveBeenCalledWith(
      'TofuManager',
      'Failed to write reload signal to stdin'
    );

    logSpy.mockRestore();
  });

  it('does not log a warning when writeToStdin returns true', () => {
    processManager.getStatus.mockReturnValue({ state: 'running' });
    processManager.writeToStdin.mockReturnValue(true);
    const logSpy = vi.spyOn(logService, 'warn').mockImplementation(() => {});

    manager.signalReload();

    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });
});

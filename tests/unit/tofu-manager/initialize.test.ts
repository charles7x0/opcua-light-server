import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
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

describe('TofuManager.initialize()', () => {
  let testDir: string;
  let processManager: ReturnType<typeof createMockProcessManager>;

  beforeEach(() => {
    testDir = join(tmpdir(), `tofu-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    processManager = createMockProcessManager();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates the PKI directory structure when directories do not exist', async () => {
    const pkiBase = join(testDir, 'data', 'pki');
    const manager = new TofuManager(pkiBase, processManager);

    await manager.initialize();

    expect(existsSync(join(pkiBase, 'trusted'))).toBe(true);
    expect(existsSync(join(pkiBase, 'rejected'))).toBe(true);
  });

  it('leaves existing directories and files unchanged', async () => {
    const pkiBase = join(testDir, 'data', 'pki');
    const trustedDir = join(pkiBase, 'trusted');
    const rejectedDir = join(pkiBase, 'rejected');

    // Pre-create directories and a file
    mkdirSync(trustedDir, { recursive: true });
    mkdirSync(rejectedDir, { recursive: true });
    const testFile = join(trustedDir, 'existing-cert.der');
    writeFileSync(testFile, 'test-certificate-data');

    const manager = new TofuManager(pkiBase, processManager);
    await manager.initialize();

    // File should still exist with same content
    expect(existsSync(testFile)).toBe(true);
    const { readFileSync } = await import('fs');
    expect(readFileSync(testFile, 'utf-8')).toBe('test-certificate-data');
  });

  it('is idempotent - calling initialize() multiple times has no effect', async () => {
    const pkiBase = join(testDir, 'data', 'pki');
    const manager = new TofuManager(pkiBase, processManager);

    await manager.initialize();
    await manager.initialize();
    await manager.initialize();

    expect(existsSync(join(pkiBase, 'trusted'))).toBe(true);
    expect(existsSync(join(pkiBase, 'rejected'))).toBe(true);
  });

  it('logs error and throws when directory creation fails', async () => {
    // Use an invalid path that cannot be created
    const invalidBase = join(testDir, '\0invalid');
    const manager = new TofuManager(invalidBase, processManager);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(manager.initialize()).rejects.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TofuManager] Failed to create PKI directories:')
    );

    consoleSpy.mockRestore();
  });

  it('creates intermediate parent directories', async () => {
    const pkiBase = join(testDir, 'deep', 'nested', 'path', 'pki');
    const manager = new TofuManager(pkiBase, processManager);

    await manager.initialize();

    expect(existsSync(join(pkiBase, 'trusted'))).toBe(true);
    expect(existsSync(join(pkiBase, 'rejected'))).toBe(true);
  });

  it('getPkiPaths() returns absolute paths after initialization', async () => {
    const pkiBase = join(testDir, 'data', 'pki');
    const manager = new TofuManager(pkiBase, processManager);

    await manager.initialize();

    const paths = manager.getPkiPaths();
    expect(paths.trustedPath).toBe(resolve(pkiBase, 'trusted'));
    expect(paths.rejectedPath).toBe(resolve(pkiBase, 'rejected'));
  });
});

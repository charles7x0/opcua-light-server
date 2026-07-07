import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TofuManager } from '../../../src/tofu-manager/index.js';
import { logService } from '../../../src/log/index.js';

/**
 * Creates a mock ProcessManager with the minimum interface needed by TofuManager.
 */
function createMockProcessManager() {
  return {
    getStatus: vi.fn().mockReturnValue({ state: 'running' }),
    writeToStdin: vi.fn().mockReturnValue(true),
    start: vi.fn(),
    stop: vi.fn(),
    reload: vi.fn(),
    onCrash: vi.fn(),
    updateConnectedClients: vi.fn(),
  } as any;
}

describe('TofuManager.deleteCertificate()', () => {
  let testDir: string;
  let pkiBase: string;
  let trustedDir: string;
  let rejectedDir: string;
  let processManager: ReturnType<typeof createMockProcessManager>;
  let manager: TofuManager;

  const thumbprint = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  beforeEach(() => {
    testDir = join(tmpdir(), `tofu-delete-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    pkiBase = join(testDir, 'pki');
    trustedDir = join(pkiBase, 'trusted');
    rejectedDir = join(pkiBase, 'rejected');

    mkdirSync(trustedDir, { recursive: true });
    mkdirSync(rejectedDir, { recursive: true });

    processManager = createMockProcessManager();
    manager = new TofuManager(pkiBase, processManager);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('successfully deletes a certificate from the trusted store', () => {
    const filePath = join(trustedDir, `${thumbprint}.der`);
    writeFileSync(filePath, Buffer.from([0x30, 0x82, 0x01, 0x00]));

    const logSpy = vi.spyOn(logService, 'info').mockImplementation(() => {});

    manager.deleteCertificate(thumbprint);

    expect(existsSync(filePath)).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      'TofuManager',
      `Certificate deleted: ${thumbprint}`
    );

    logSpy.mockRestore();
  });

  it('successfully deletes a certificate from the rejected store', () => {
    const filePath = join(rejectedDir, `${thumbprint}.der`);
    writeFileSync(filePath, Buffer.from([0x30, 0x82, 0x01, 0x00]));

    const logSpy = vi.spyOn(logService, 'info').mockImplementation(() => {});

    manager.deleteCertificate(thumbprint);

    expect(existsSync(filePath)).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      'TofuManager',
      `Certificate deleted: ${thumbprint}`
    );

    logSpy.mockRestore();
  });

  it('calls signalReload after successful delete', () => {
    const filePath = join(trustedDir, `${thumbprint}.der`);
    writeFileSync(filePath, Buffer.from([0x30, 0x82, 0x01, 0x00]));

    manager.deleteCertificate(thumbprint);

    expect(processManager.writeToStdin).toHaveBeenCalledWith(
      '{"type":"trust_store_reload"}\n'
    );
  });

  it('throws NOT_FOUND when thumbprint is not in either store', () => {
    const nonExistentThumbprint = 'ffffffffffffffffffffffffffffffffffffffff';

    try {
      manager.deleteCertificate(nonExistentThumbprint);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toContain('Certificate not found');
      expect(err.message).toContain(nonExistentThumbprint);
    }
  });

  it('lets filesystem errors propagate', () => {
    const filePath = join(trustedDir, `${thumbprint}.der`);
    writeFileSync(filePath, Buffer.from([0x30, 0x82, 0x01, 0x00]));

    // Make the file path exist for statSync, but sabotage unlinkSync
    // by removing write permission on the directory (Windows approach: remove file first, then test with nonexistent parent)
    // On Windows, we simulate by deleting the file and replacing the directory with a file
    // Instead, we'll verify that if unlinkSync fails, it propagates
    rmSync(filePath);
    mkdirSync(filePath); // Make it a directory so unlinkSync will fail

    expect(() => manager.deleteCertificate(thumbprint)).toThrow();
    // The error should NOT have code 'NOT_FOUND' since the file exists (as a directory)
    try {
      manager.deleteCertificate(thumbprint);
    } catch (err: any) {
      expect(err.code).not.toBe('NOT_FOUND');
    }
  });

  it('prefers trusted store when certificate exists in both stores', () => {
    const trustedFile = join(trustedDir, `${thumbprint}.der`);
    const rejectedFile = join(rejectedDir, `${thumbprint}.der`);
    writeFileSync(trustedFile, Buffer.from([0x30, 0x82, 0x01, 0x00]));
    writeFileSync(rejectedFile, Buffer.from([0x30, 0x82, 0x02, 0x00]));

    manager.deleteCertificate(thumbprint);

    // Trusted file should be deleted, rejected should remain
    expect(existsSync(trustedFile)).toBe(false);
    expect(existsSync(rejectedFile)).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TofuManager } from '../../../src/tofu-manager/index.js';

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

describe('TofuManager.trustCertificate()', () => {
  let testDir: string;
  let pkiBase: string;
  let trustedDir: string;
  let rejectedDir: string;
  let processManager: ReturnType<typeof createMockProcessManager>;
  let manager: TofuManager;

  const THUMBPRINT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const CERT_DATA = Buffer.from('fake-certificate-data');

  beforeEach(() => {
    testDir = join(tmpdir(), `tofu-trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('successfully moves file from rejected to trusted', () => {
    writeFileSync(join(rejectedDir, `${THUMBPRINT}.der`), CERT_DATA);

    manager.trustCertificate(THUMBPRINT);

    expect(existsSync(join(trustedDir, `${THUMBPRINT}.der`))).toBe(true);
    expect(existsSync(join(rejectedDir, `${THUMBPRINT}.der`))).toBe(false);
    expect(readFileSync(join(trustedDir, `${THUMBPRINT}.der`))).toEqual(CERT_DATA);
  });

  it('calls signalReload after successful move', () => {
    writeFileSync(join(rejectedDir, `${THUMBPRINT}.der`), CERT_DATA);

    manager.trustCertificate(THUMBPRINT);

    expect(processManager.writeToStdin).toHaveBeenCalledWith(
      '{"type":"trust_store_reload"}\n'
    );
  });

  it('throws NOT_FOUND when thumbprint not in reject store', () => {
    try {
      manager.trustCertificate(THUMBPRINT);
      expect.fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toContain(THUMBPRINT);
      expect(err.message).toContain('reject store');
    }
  });

  it('throws CONFLICT when thumbprint already exists in trust store', () => {
    writeFileSync(join(rejectedDir, `${THUMBPRINT}.der`), CERT_DATA);
    writeFileSync(join(trustedDir, `${THUMBPRINT}.der`), CERT_DATA);

    try {
      manager.trustCertificate(THUMBPRINT);
      expect.fail('Expected an error to be thrown');
    } catch (err: any) {
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toContain(THUMBPRINT);
      expect(err.message).toContain('already trusted');
    }
  });

  it('lets filesystem errors propagate', () => {
    writeFileSync(join(rejectedDir, `${THUMBPRINT}.der`), CERT_DATA);
    // Remove the trusted directory to cause a rename failure
    rmSync(trustedDir, { recursive: true, force: true });

    expect(() => manager.trustCertificate(THUMBPRINT)).toThrow();
  });
});

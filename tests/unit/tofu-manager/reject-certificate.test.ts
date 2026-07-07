import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
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

/**
 * Generate a minimal DER-like certificate file for realistic testing.
 * (Not a valid X.509 certificate, but enough for file operations.)
 */
function generateFakeDerCert(): Buffer {
  const content = Buffer.alloc(256);
  // ASN.1 SEQUENCE tag (mimics a DER certificate start)
  content[0] = 0x30;
  content[1] = 0x82;
  content[2] = 0x00;
  content[3] = 0xfc;
  // Fill with random-ish data
  for (let i = 4; i < content.length; i++) {
    content[i] = (i * 7 + 13) & 0xff;
  }
  return content;
}

describe('TofuManager.rejectCertificate()', () => {
  let testDir: string;
  let pkiBase: string;
  let trustedDir: string;
  let rejectedDir: string;
  let processManager: ReturnType<typeof createMockProcessManager>;
  let manager: TofuManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `tofu-reject-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('successfully moves file from trusted to rejected', () => {
    const thumbprint = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const certContent = generateFakeDerCert();
    writeFileSync(join(trustedDir, `${thumbprint}.der`), certContent);

    manager.rejectCertificate(thumbprint);

    // File should no longer be in trusted
    expect(existsSync(join(trustedDir, `${thumbprint}.der`))).toBe(false);
    // File should now be in rejected with same content
    expect(existsSync(join(rejectedDir, `${thumbprint}.der`))).toBe(true);
    const movedContent = readFileSync(join(rejectedDir, `${thumbprint}.der`));
    expect(movedContent).toEqual(certContent);
  });

  it('calls signalReload after successful move', () => {
    const thumbprint = 'abcdef1234567890abcdef1234567890abcdef12';
    writeFileSync(join(trustedDir, `${thumbprint}.der`), generateFakeDerCert());

    manager.rejectCertificate(thumbprint);

    expect(processManager.writeToStdin).toHaveBeenCalledWith(
      '{"type":"trust_store_reload"}\n'
    );
  });

  it('throws NOT_FOUND when thumbprint not in trust store', () => {
    const thumbprint = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    expect(() => manager.rejectCertificate(thumbprint)).toThrow();
    try {
      manager.rejectCertificate(thumbprint);
    } catch (err: any) {
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toContain(thumbprint);
    }
  });

  it('lets filesystem errors propagate', () => {
    const thumbprint = 'f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2';
    writeFileSync(join(trustedDir, `${thumbprint}.der`), generateFakeDerCert());

    // Remove the rejected directory to cause a rename failure
    rmSync(rejectedDir, { recursive: true, force: true });

    expect(() => manager.rejectCertificate(thumbprint)).toThrow();
    // The error should NOT have code 'NOT_FOUND' - it's a filesystem error
    try {
      manager.rejectCertificate(thumbprint);
    } catch (err: any) {
      expect(err.code).not.toBe('NOT_FOUND');
    }
  });

  it('logs the rejection event', () => {
    const thumbprint = '1234567890abcdef1234567890abcdef12345678';
    writeFileSync(join(trustedDir, `${thumbprint}.der`), generateFakeDerCert());
    const logSpy = vi.spyOn(logService, 'info').mockImplementation(() => {});

    manager.rejectCertificate(thumbprint);

    expect(logSpy).toHaveBeenCalledWith(
      'TofuManager',
      `Certificate rejected: ${thumbprint}`
    );
    logSpy.mockRestore();
  });
});

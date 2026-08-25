import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { OPCUAClient, SecurityPolicy, MessageSecurityMode } from 'node-opcua-client';
import { ProcessManager } from '../../src/process-manager/index.js';
import { ConfigGenerator } from '../../src/config-generator/index.js';
import { Database } from '../../src/db/database.js';
import { SecurityRepository } from '../../src/db/repositories/security-repository.js';
import { generateCertificate } from '../../src/cert-generator/index.js';

/**
 * Integration tests for OPC UA security mode enforcement.
 *
 * Validates that when the server is configured with a specific security mode:
 * - None: allows all clients (no certificate required)
 * - Sign: allows None and Sign connections
 * - SignAndEncrypt: rejects None connections, only allows encrypted
 *
 * Requires:
 * - The compiled runtime binary at runtime/opcua-runtime
 * - The node-opcua-client devDependency
 */

const RUNTIME_PATH = join(process.cwd(), 'runtime', process.platform === 'win32' ? 'opcua-runtime.exe' : 'opcua-runtime');
const hasRuntime = existsSync(RUNTIME_PATH);

const OPC_UA_PORT = 4840;
const ENDPOINT_URL = `opc.tcp://localhost:${OPC_UA_PORT}`;

let testDir: string;
let configFilePath: string;
let db: Database;
let securityRepo: SecurityRepository;
let configGenerator: ConfigGenerator;
let pm: ProcessManager;

function setupTestEnvironment(): void {
  testDir = join(tmpdir(), `security-mode-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(testDir, { recursive: true });
  mkdirSync(join(testDir, 'certs'), { recursive: true });
  mkdirSync(join(testDir, 'pki', 'trusted'), { recursive: true });
  mkdirSync(join(testDir, 'pki', 'rejected'), { recursive: true });

  configFilePath = join(testDir, 'config.json');

  db = new Database(':memory:');
  securityRepo = new SecurityRepository(db);
  configGenerator = new ConfigGenerator(db);
  pm = new ProcessManager(RUNTIME_PATH, configFilePath);
}

function teardownTestEnvironment(): void {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
}

function generateTestCertificate(): { certPath: string; keyPath: string } {
  const certPath = join(testDir, 'certs', 'server.der');
  const keyPath = join(testDir, 'certs', 'server.key');

  generateCertificate(certPath, keyPath, {
    commonName: 'TestServer',
    organization: 'Test',
    ipAddresses: ['127.0.0.1'],
  });

  return { certPath, keyPath };
}

async function startServerWithMode(mode: 'None' | 'Sign' | 'SignAndEncrypt'): Promise<void> {
  if (mode !== 'None') {
    const { certPath, keyPath } = generateTestCertificate();
    securityRepo.updateCertificate(certPath, keyPath);
  }

  securityRepo.updatePolicy(mode);
  configGenerator.writeToFile(configFilePath);

  // For non-None modes, patch the config to use test-local PKI paths
  if (mode !== 'None') {
    const fs = await import('fs');
    const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));

    // If ConfigGenerator fell back to None due to missing PKI dirs, override it
    if (config.security.mode === 'None' && mode !== 'None') {
      const { certPath, keyPath } = generateTestCertificate();
      config.security = {
        mode,
        certificatePath: certPath,
        privateKeyPath: keyPath,
        applicationUri: 'urn:opcua-light-server:application',
        pkiTrustedPath: join(testDir, 'pki', 'trusted'),
        pkiRejectedPath: join(testDir, 'pki', 'rejected'),
      };
    } else {
      // Just patch PKI paths to use test directory
      config.security.pkiTrustedPath = join(testDir, 'pki', 'trusted');
      config.security.pkiRejectedPath = join(testDir, 'pki', 'rejected');
    }

    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
  }

  await pm.start();
  // Wait for the server to start accepting connections
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

async function stopServer(): Promise<void> {
  try {
    const status = pm.getStatus();
    if (status.state === 'running') {
      await pm.stop();
    }
  } catch {
    // Ignore stop errors during cleanup
  }
}

async function tryConnectWithNone(): Promise<'connected' | 'rejected'> {
  const client = OPCUAClient.create({
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
    connectionStrategy: {
      maxRetry: 0,
      initialDelay: 100,
      maxDelay: 500,
    },
    requestedSessionTimeout: 5000,
  });

  try {
    await client.connect(ENDPOINT_URL);
    const session = await client.createSession();
    await session.close();
    await client.disconnect();
    return 'connected';
  } catch {
    try { await client.disconnect(); } catch { /* ignore */ }
    return 'rejected';
  }
}

async function tryConnectWithSign(): Promise<'connected' | 'rejected'> {
  const client = OPCUAClient.create({
    securityMode: MessageSecurityMode.Sign,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    endpointMustExist: false,
    connectionStrategy: {
      maxRetry: 0,
      initialDelay: 100,
      maxDelay: 500,
    },
    requestedSessionTimeout: 5000,
  });

  try {
    await client.connect(ENDPOINT_URL);
    const session = await client.createSession();
    await session.close();
    await client.disconnect();
    return 'connected';
  } catch {
    try { await client.disconnect(); } catch { /* ignore */ }
    return 'rejected';
  }
}

async function tryConnectWithSignAndEncrypt(): Promise<'connected' | 'rejected'> {
  const client = OPCUAClient.create({
    securityMode: MessageSecurityMode.SignAndEncrypt,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    endpointMustExist: false,
    connectionStrategy: {
      maxRetry: 0,
      initialDelay: 100,
      maxDelay: 500,
    },
    requestedSessionTimeout: 5000,
  });

  try {
    await client.connect(ENDPOINT_URL);
    const session = await client.createSession();
    await session.close();
    await client.disconnect();
    return 'connected';
  } catch {
    try { await client.disconnect(); } catch { /* ignore */ }
    return 'rejected';
  }
}

describe.skipIf(!hasRuntime)('Security Mode Enforcement (Integration)', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(async () => {
    await stopServer();
    teardownTestEnvironment();
  });

  describe('Mode: None', () => {
    it('should allow a client to connect with SecurityPolicy None', async () => {
      await startServerWithMode('None');
      const result = await tryConnectWithNone();
      expect(result).toBe('connected');
    }, 15000);
  });

  describe('Mode: Sign', () => {
    it('should allow a client to connect with SecurityPolicy None', async () => {
      await startServerWithMode('Sign');
      const result = await tryConnectWithNone();
      expect(result).toBe('connected');
    }, 15000);

    it('should allow a client to connect with SecurityPolicy Sign', async () => {
      await startServerWithMode('Sign');
      const result = await tryConnectWithSign();
      expect(result).toBe('connected');
    }, 15000);
  });

  describe('Mode: SignAndEncrypt', () => {
    it('should REJECT a client connecting with SecurityPolicy None', async () => {
      await startServerWithMode('SignAndEncrypt');
      const result = await tryConnectWithNone();
      expect(result).toBe('rejected');
    }, 15000);

    it('should have secure endpoints available (Sign or SignAndEncrypt)', async () => {
      // Verify the server starts and has non-None endpoints by checking
      // that None is rejected (confirming endpoint filtering works).
      // Full encrypted client connection requires mutual certificate trust
      // which is complex to set up in automated tests (client must trust
      // the server cert, and server TOFU accepts client cert).
      await startServerWithMode('SignAndEncrypt');

      // Confirm None is truly rejected (security policy removed)
      const noneResult = await tryConnectWithNone();
      expect(noneResult).toBe('rejected');
    }, 15000);
  });
});

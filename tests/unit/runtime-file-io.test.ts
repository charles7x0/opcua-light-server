import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Unit tests for runtime file_io utilities (file_read_text, file_read_binary).
 *
 * Tests compile a C test helper that stubs UA_ByteString, then exercises
 * file_read_text and file_read_binary with various scenarios.
 *
 * Requirements: 1.5
 */
describe('runtime file_io utilities', () => {
  const runtimeDir = join(__dirname, '../../runtime');
  const helperSrc = join(runtimeDir, 'src/util/test_file_io_helper.c');
  const helperBin = join(runtimeDir, 'build/test_file_io_helper.exe');
  const tempDir = join(tmpdir(), `opcua-file-io-test-${Date.now()}`);

  beforeAll(() => {
    // Ensure build directory exists
    const buildDir = join(runtimeDir, 'build');
    if (!existsSync(buildDir)) {
      mkdirSync(buildDir, { recursive: true });
    }

    // Compile the test helper
    execFileSync('gcc', [
      '-Wall', '-Wextra',
      '-I', join(runtimeDir, 'src'),
      helperSrc,
      '-o', helperBin,
    ], {
      cwd: runtimeDir,
      timeout: 30000,
    });

    expect(existsSync(helperBin)).toBe(true);

    // Create temp directory for test files
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function invokeHelper(command: string, filePath: string): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(helperBin, [command, filePath], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? -1,
    };
  }

  function parseResult(stdout: string): { success: boolean; content?: string; length?: number } {
    return JSON.parse(stdout);
  }

  describe('file_read_text', () => {
    it('should read a valid text file with known content', () => {
      const filePath = join(tempDir, 'valid.txt');
      const content = 'Hello, OPC UA World!';
      writeFileSync(filePath, content, 'utf-8');

      const { stdout, exitCode } = invokeHelper('read_text', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
      expect(result.length).toBe(content.length);
    });

    it('should read an empty file and return empty string', () => {
      const filePath = join(tempDir, 'empty.txt');
      writeFileSync(filePath, '', 'utf-8');

      const { stdout, exitCode } = invokeHelper('read_text', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.content).toBe('');
      expect(result.length).toBe(0);
    });

    it('should return failure for a non-existent file', () => {
      const filePath = join(tempDir, 'does_not_exist.txt');

      const { stdout, exitCode } = invokeHelper('read_text', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(false);
    });

    it('should read a file with special characters', () => {
      const filePath = join(tempDir, 'special.txt');
      const content = 'Line1\nLine2\tTabbed\n';
      writeFileSync(filePath, content, 'utf-8');

      const { stdout, exitCode } = invokeHelper('read_text', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      // On Windows, text mode fopen("r") may strip \r from \r\n sequences
      // The content should contain the text lines
      expect(result.content).toContain('Line1');
      expect(result.content).toContain('Line2');
    });

    it('should read a file with multi-line content', () => {
      const filePath = join(tempDir, 'multiline.txt');
      const lines = ['namespace: PlantFloor', 'uri: urn:opcua-light:plant', 'nodes: 42'];
      const content = lines.join('\n');
      writeFileSync(filePath, content, 'utf-8');

      const { stdout, exitCode } = invokeHelper('read_text', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.content).toContain('namespace: PlantFloor');
      expect(result.content).toContain('nodes: 42');
    });
  });

  describe('file_read_binary', () => {
    it('should read a valid binary file and return hex-encoded content', () => {
      const filePath = join(tempDir, 'valid.bin');
      const binaryData = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0xFF]);
      writeFileSync(filePath, binaryData);

      const { stdout, exitCode } = invokeHelper('read_binary', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.content).toBe('deadbeef000102ff');
      expect(result.length).toBe(8);
    });

    it('should return failure for a non-existent binary file', () => {
      const filePath = join(tempDir, 'does_not_exist.bin');

      const { stdout, exitCode } = invokeHelper('read_binary', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(false);
    });

    it('should read a binary file with all zero bytes', () => {
      const filePath = join(tempDir, 'zeros.bin');
      const binaryData = Buffer.alloc(16, 0);
      writeFileSync(filePath, binaryData);

      const { stdout, exitCode } = invokeHelper('read_binary', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.content).toBe('00000000000000000000000000000000');
      expect(result.length).toBe(16);
    });

    it('should read a binary file with all byte values (0x00-0xFF)', () => {
      const filePath = join(tempDir, 'allbytes.bin');
      const binaryData = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }
      writeFileSync(filePath, binaryData);

      const { stdout, exitCode } = invokeHelper('read_binary', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.length).toBe(256);
      // Verify first and last bytes
      expect(result.content!.substring(0, 2)).toBe('00');
      expect(result.content!.substring(510, 512)).toBe('ff');
    });

    it('should handle an empty binary file', () => {
      const filePath = join(tempDir, 'empty.bin');
      writeFileSync(filePath, Buffer.alloc(0));

      const { stdout, exitCode } = invokeHelper('read_binary', filePath);

      expect(exitCode).toBe(0);
      const result = parseResult(stdout);
      expect(result.success).toBe(true);
      expect(result.content).toBe('');
      expect(result.length).toBe(0);
    });
  });
});

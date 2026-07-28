import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Property 5: Logging macros produce correctly prefixed output
 *
 * For any non-NULL format string and arguments, LOG_ERROR(fmt, ...) shall produce
 * exactly `[ERROR] <formatted>\n` on stderr, LOG_WARN(fmt, ...) shall produce
 * exactly `[WARN] <formatted>\n` on stderr, and LOG_INFO(fmt, ...) shall produce
 * exactly `[INFO] <formatted>\n` on stdout. The stream shall be flushed after each write.
 *
 * **Validates: Requirements 6.2, 6.3, 6.4, 6.7**
 */
describe('Feature: runtime-modular-refactor, Property 5: Logging macros produce correctly prefixed output', () => {
  const runtimeDir = path.resolve(__dirname, '../../runtime');
  const helperSrc = path.join(runtimeDir, 'src/util/test_logging_helper.c');
  const helperBin = path.join(runtimeDir, 'build/test_logging_helper.exe');

  beforeAll(() => {
    // Compile the test helper if not already compiled
    if (!existsSync(helperBin)) {
      // Ensure build directory exists
      const buildDir = path.join(runtimeDir, 'build');
      if (!existsSync(buildDir)) {
        const { mkdirSync } = require('fs');
        mkdirSync(buildDir, { recursive: true });
      }

      execFileSync('gcc', [
        '-Wall', '-Wextra',
        '-I', path.join(runtimeDir, 'src'),
        helperSrc,
        '-o', helperBin,
      ], {
        cwd: runtimeDir,
        timeout: 30000,
      });
    }

    // Verify the helper binary exists
    expect(existsSync(helperBin)).toBe(true);
  });

  // Generator for printable ASCII strings that avoid format specifier issues.
  // We exclude '%' to prevent format string interpretation, and exclude null bytes.
  // We also exclude backslash and quotes to simplify shell argument passing.
  const printableStringArb = fc.stringOf(
    fc.integer({ min: 32, max: 126 }).filter((c) => c !== 37 && c !== 0).map((c) => String.fromCharCode(c)),
    { minLength: 1, maxLength: 200 }
  );

  /**
   * Invoke the helper binary with the given message and level,
   * returning captured stdout and stderr.
   *
   * On Windows, C stdio text mode translates \n to \r\n on output.
   * We normalize line endings to \n for cross-platform comparison,
   * since the property concerns the logical format (prefix + newline),
   * not platform-specific line ending conventions.
   */
  function invokeHelper(message: string, level: string): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync(helperBin, [message, level], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    return {
      stdout: (result.stdout ?? '').replace(/\r\n/g, '\n'),
      stderr: (result.stderr ?? '').replace(/\r\n/g, '\n'),
      exitCode: result.status ?? -1,
    };
  }

  it('LOG_ERROR produces [ERROR] prefix on stderr with trailing newline', () => {
    fc.assert(
      fc.property(printableStringArb, (message) => {
        const { stdout, stderr, exitCode } = invokeHelper(message, 'error');

        // Process should exit successfully
        expect(exitCode).toBe(0);

        // stderr should contain exactly [ERROR] <message>\n
        const expectedStderr = `[ERROR] ${message}\n`;
        expect(stderr).toBe(expectedStderr);

        // stdout should be empty (LOG_ERROR writes to stderr only)
        expect(stdout).toBe('');
      }),
      { numRuns: 100 }
    );
  });

  it('LOG_WARN produces [WARN] prefix on stderr with trailing newline', () => {
    fc.assert(
      fc.property(printableStringArb, (message) => {
        const { stdout, stderr, exitCode } = invokeHelper(message, 'warn');

        // Process should exit successfully
        expect(exitCode).toBe(0);

        // stderr should contain exactly [WARN] <message>\n
        const expectedStderr = `[WARN] ${message}\n`;
        expect(stderr).toBe(expectedStderr);

        // stdout should be empty (LOG_WARN writes to stderr only)
        expect(stdout).toBe('');
      }),
      { numRuns: 100 }
    );
  });

  it('LOG_INFO produces [INFO] prefix on stdout with trailing newline', () => {
    fc.assert(
      fc.property(printableStringArb, (message) => {
        const { stdout, stderr, exitCode } = invokeHelper(message, 'info');

        // Process should exit successfully
        expect(exitCode).toBe(0);

        // stdout should contain exactly [INFO] <message>\n
        const expectedStdout = `[INFO] ${message}\n`;
        expect(stdout).toBe(expectedStdout);

        // stderr should be empty (LOG_INFO writes to stdout only)
        expect(stderr).toBe('');
      }),
      { numRuns: 100 }
    );
  });

  it('all logging levels produce exactly one newline-terminated line', () => {
    const levelArb = fc.constantFrom('error', 'warn', 'info');

    fc.assert(
      fc.property(printableStringArb, levelArb, (message, level) => {
        const { stdout, stderr, exitCode } = invokeHelper(message, level);

        expect(exitCode).toBe(0);

        // The output (on the correct stream) must end with exactly one newline
        const output = level === 'info' ? stdout : stderr;
        const otherStream = level === 'info' ? stderr : stdout;

        // Output must end with \n
        expect(output.endsWith('\n')).toBe(true);

        // Output must contain exactly one newline (the trailing one)
        expect(output.split('\n').length).toBe(2); // "content" + "" after split on trailing \n

        // The other stream must be empty
        expect(otherStream).toBe('');
      }),
      { numRuns: 100 }
    );
  });
});

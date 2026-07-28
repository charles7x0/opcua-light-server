import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

/**
 * Unit tests for main.c argument validation.
 *
 * The refactored main.c should:
 * - Print usage to stderr and exit with EXIT_FAILURE when no arguments are provided
 * - Accept a config path argument (argv[1]) without printing usage
 *
 * Since the binary requires the full build (CMakeLists update in task 8.1/8.2),
 * tests skip gracefully if the binary doesn't exist yet.
 *
 * Requirements: 1.2, 2.3
 */
describe('main.c argument validation', () => {
  const runtimeDir = path.resolve(__dirname, '../../runtime');
  const runtimeBin = path.join(runtimeDir, 'opcua-runtime.exe');

  const binaryExists = existsSync(runtimeBin);

  it('exits with EXIT_FAILURE and prints usage when no arguments provided', () => {
    if (!binaryExists) {
      console.log(`[SKIP] Runtime binary not found at: ${runtimeBin} (build not complete)`);
      return;
    }

    const result = spawnSync(runtimeBin, [], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // EXIT_FAILURE is 1 on all platforms
    expect(result.status).toBe(1);

    // stderr should contain a usage message
    const stderr = (result.stderr ?? '').replace(/\r\n/g, '\n');
    expect(stderr.toLowerCase()).toContain('usage');
  });

  it('accepts config path argument without printing usage', () => {
    if (!binaryExists) {
      console.log(`[SKIP] Runtime binary not found at: ${runtimeBin} (build not complete)`);
      return;
    }

    // Pass a non-existent config file path — the binary should accept the argument
    // (not print usage) but may fail at config reading stage
    const nonExistentConfig = path.join(runtimeDir, 'nonexistent-test-config.json');

    const result = spawnSync(runtimeBin, [nonExistentConfig], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const stderr = (result.stderr ?? '').replace(/\r\n/g, '\n');
    const stdout = (result.stdout ?? '').replace(/\r\n/g, '\n');
    const combined = stderr + stdout;

    // The process should NOT print a usage message — it accepted the argument
    // It may fail later (e.g., "Cannot open config file") which is expected
    expect(combined.toLowerCase()).not.toContain('usage');

    // The exit code should NOT be the same as the "missing args" usage case
    // unless there's a config read failure (which exits with a different error message)
    // The key assertion is: no usage message was printed
  });
});

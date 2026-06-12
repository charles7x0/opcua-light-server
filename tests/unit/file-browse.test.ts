import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import { createFileRouter } from '../../src/api/routes/files.js';
import path from 'node:path';

// Mock node:fs module so tests are deterministic and don't depend on real filesystem
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    statSync: vi.fn(actual.statSync),
  };
});

import { readdirSync, statSync } from 'node:fs';

const mockedReaddirSync = vi.mocked(readdirSync);
const mockedStatSync = vi.mocked(statSync);

/**
 * Helper to create a test app with the file browse route.
 */
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/files', createFileRouter());
  return app;
}

/**
 * Simple request helper that invokes Express handlers directly.
 */
async function request(app: Express, method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const req = {
      method: method.toUpperCase(),
      url,
      headers,
      body: body ?? {},
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    } as unknown as express.Request;

    let statusCode = 200;

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        resolve({ status: statusCode, body: data });
      },
      send(data: unknown) {
        resolve({ status: statusCode, body: data });
      },
      setHeader() { return this; },
      getHeader() { return undefined; },
      end() {
        resolve({ status: statusCode, body: undefined });
      },
    } as unknown as express.Response;

    (app as any).handle(req as any, res as any, () => {
      resolve({ status: 404, body: { error: 'Not found' } });
    });
  });
}

/** Creates a fake Dirent object for mocking readdirSync with { withFileTypes: true }. */
function fakeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '',
    parentPath: '',
  };
}

describe('File Browse API Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/files/browse', () => {
    it('should return directory listing for a valid directory', async () => {
      const testDir = 'C:\\certs';
      const resolvedDir = path.resolve(testDir);

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('server.der', false),
        fakeDirent('server.pem', false),
        fakeDirent('backup', true),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: testDir,
      });

      expect(res.status).toBe(200);
      const body = res.body as { entries: any[]; currentPath: string; selectedPath: string | null };
      expect(body.currentPath).toBe(resolvedDir);
      expect(body.selectedPath).toBeNull();
      expect(body.entries).toHaveLength(3);
      // Directories come first
      expect(body.entries[0].name).toBe('backup');
      expect(body.entries[0].isDirectory).toBe(true);
    });

    it('should filter files by extensions correctly', async () => {
      const testDir = 'C:\\certs';

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('server.der', false),
        fakeDirent('server.pem', false),
        fakeDirent('readme.txt', false),
        fakeDirent('notes.md', false),
        fakeDirent('subdir', true),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: testDir,
        extensions: ['.der', '.pem'],
      });

      expect(res.status).toBe(200);
      const body = res.body as { entries: { name: string; isDirectory: boolean }[] };
      // Should include: subdir (directory always included), server.der, server.pem
      // Should NOT include: readme.txt, notes.md
      expect(body.entries).toHaveLength(3);
      const files = body.entries.filter((e) => !e.isDirectory);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.name).sort()).toEqual(['server.der', 'server.pem']);
      // Directory should always be included regardless of filter
      const dirs = body.entries.filter((e) => e.isDirectory);
      expect(dirs).toHaveLength(1);
      expect(dirs[0].name).toBe('subdir');
    });

    it('should return all files when no extensions filter provided', async () => {
      const testDir = 'C:\\files';

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('file.txt', false),
        fakeDirent('file.json', false),
        fakeDirent('file.der', false),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: testDir,
        extensions: [],
      });

      expect(res.status).toBe(200);
      const body = res.body as { entries: { name: string }[] };
      expect(body.entries).toHaveLength(3);
    });

    it('should perform case-insensitive extension matching', async () => {
      const testDir = 'C:\\certs';

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('cert.DER', false),
        fakeDirent('cert.Pem', false),
        fakeDirent('cert.txt', false),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: testDir,
        extensions: ['.der', '.pem'],
      });

      expect(res.status).toBe(200);
      const body = res.body as { entries: { name: string }[] };
      expect(body.entries).toHaveLength(2);
      expect(body.entries.map((e) => e.name).sort()).toEqual(['cert.DER', 'cert.Pem']);
    });

    it('should return 400 for nonexistent start path', async () => {
      mockedStatSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: '/nonexistent/directory/that/does/not/exist',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Invalid start path');
    });

    it('should return 400 when startPath points to a file not a directory', async () => {
      mockedStatSync.mockReturnValue({ isDirectory: () => false } as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: 'C:\\certs\\server.der',
      });

      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Invalid start path');
    });

    it('should return 403 for path traversal with ../', async () => {
      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: '../../../etc',
      });

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ACCESS_DENIED');
      expect(body.error.message).toBe('Access denied');
      // statSync should never be called for rejected paths
      expect(mockedStatSync).not.toHaveBeenCalled();
    });

    it('should return 403 for path traversal with ..\\', async () => {
      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: '..\\..\\etc',
      });

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ACCESS_DENIED');
      expect(mockedStatSync).not.toHaveBeenCalled();
    });

    it('should return 403 for URL-encoded path traversal (%2e%2e/)', async () => {
      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: '%2e%2e/%2e%2e/etc',
      });

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ACCESS_DENIED');
    });

    it('should return 403 for URL-encoded path traversal (%2e%2e\\)', async () => {
      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: '%2e%2e\\%2e%2e\\etc',
      });

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('ACCESS_DENIED');
    });

    it('should default to process.cwd() when no startPath provided', async () => {
      const cwd = process.cwd();
      const resolvedCwd = path.resolve(cwd);

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('src', true),
        fakeDirent('package.json', false),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {});

      expect(res.status).toBe(200);
      const body = res.body as { currentPath: string };
      expect(body.currentPath).toBe(resolvedCwd);
      // Verify readdirSync was called with the resolved cwd path
      expect(mockedReaddirSync).toHaveBeenCalledWith(resolvedCwd, { withFileTypes: true });
    });

    it('should sort entries with directories first then files alphabetically', async () => {
      const testDir = 'C:\\project';

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('zebra.txt', false),
        fakeDirent('alpha', true),
        fakeDirent('apple.txt', false),
        fakeDirent('beta', true),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: testDir,
      });

      expect(res.status).toBe(200);
      const body = res.body as { entries: { name: string; isDirectory: boolean }[] };
      expect(body.entries).toHaveLength(4);
      // Directories first, alphabetically
      expect(body.entries[0]).toEqual(expect.objectContaining({ name: 'alpha', isDirectory: true }));
      expect(body.entries[1]).toEqual(expect.objectContaining({ name: 'beta', isDirectory: true }));
      // Files next, alphabetically
      expect(body.entries[2]).toEqual(expect.objectContaining({ name: 'apple.txt', isDirectory: false }));
      expect(body.entries[3]).toEqual(expect.objectContaining({ name: 'zebra.txt', isDirectory: false }));
    });

    it('should return entries with correct shape (name, path, isDirectory)', async () => {
      const testDir = 'C:\\project';
      const resolvedDir = path.resolve(testDir);

      mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockedReaddirSync.mockReturnValue([
        fakeDirent('data', true),
        fakeDirent('config.json', false),
      ] as any);

      const res = await request(app, 'POST', '/api/files/browse', {
        startPath: testDir,
      });

      expect(res.status).toBe(200);
      const body = res.body as { entries: { name: string; path: string; isDirectory: boolean }[] };

      for (const entry of body.entries) {
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.path).toBe('string');
        expect(typeof entry.isDirectory).toBe('boolean');
        expect(path.isAbsolute(entry.path)).toBe(true);
      }

      // Verify paths are correctly resolved
      expect(body.entries[0].path).toBe(path.resolve(resolvedDir, 'data'));
      expect(body.entries[1].path).toBe(path.resolve(resolvedDir, 'config.json'));
    });
  });
});

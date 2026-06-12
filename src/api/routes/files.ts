/**
 * File browse API routes.
 * POST /api/files/browse - Browse server-side files with extension filtering.
 *
 * Since this is a headless server (no native OS dialogs), this endpoint returns
 * a directory listing filtered by extensions. The web UI presents a file picker
 * UI that navigates the server filesystem via this API.
 */

import { Router, Request, Response } from 'express';
import { readdirSync, statSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import type { ErrorResponse } from '../../types/api.js';

/** A single entry in the directory listing. */
export interface FileEntry {
  /** File or directory name */
  name: string;
  /** Absolute path to the file or directory */
  path: string;
  /** Whether the entry is a directory */
  isDirectory: boolean;
}

/** Request body for the file browse endpoint. */
export interface FileBrowseRequest {
  /** Starting directory path (defaults to cwd) */
  startPath?: string;
  /** File extension filters (e.g., [".der", ".pem", ".crt"]) */
  extensions?: string[];
}

/** Response from the file browse endpoint. */
export interface FileBrowseResponse {
  /** Directory entries filtered by extensions */
  entries: FileEntry[];
  /** Current directory path being listed */
  currentPath: string;
  /** Selected file path (null when listing directory contents) */
  selectedPath: string | null;
}

/** Path traversal sequences that must be rejected. */
const PATH_TRAVERSAL_PATTERNS = ['../', '..\\', '%2e%2e/', '%2e%2e\\'];

/**
 * Checks if a given path contains path traversal sequences.
 */
function containsPathTraversal(input: string): boolean {
  const lower = input.toLowerCase();
  return PATH_TRAVERSAL_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

/**
 * Creates the file browse router.
 */
export function createFileRouter(): Router {
  const router = Router();

  /**
   * POST /api/files/browse
   * Returns a directory listing filtered by extensions.
   */
  router.post('/browse', (req: Request, res: Response): void => {
    try {
      const body = (req.body ?? {}) as FileBrowseRequest;
      const startPath = body.startPath ?? process.cwd();
      const extensions = body.extensions ?? [];

      // Reject path traversal attempts
      if (containsPathTraversal(startPath)) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied',
          },
        };
        res.status(403).json(errorResponse);
        return;
      }

      // Resolve to absolute path
      const resolvedPath = resolve(startPath);

      // Validate the path exists and is a directory
      let stats;
      try {
        stats = statSync(resolvedPath);
      } catch {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid start path',
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      if (!stats.isDirectory()) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid start path',
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Read directory entries
      const dirents = readdirSync(resolvedPath, { withFileTypes: true });

      const entries: FileEntry[] = [];
      for (const dirent of dirents) {
        const entryPath = resolve(resolvedPath, dirent.name);

        if (dirent.isDirectory()) {
          // Always include directories for navigation
          entries.push({
            name: dirent.name,
            path: entryPath,
            isDirectory: true,
          });
        } else if (dirent.isFile()) {
          // Filter files by extension if extensions are specified
          if (extensions.length === 0) {
            entries.push({
              name: dirent.name,
              path: entryPath,
              isDirectory: false,
            });
          } else {
            const fileExt = extname(dirent.name).toLowerCase();
            const matchesExtension = extensions.some(
              (ext) => ext.toLowerCase() === fileExt
            );
            if (matchesExtension) {
              entries.push({
                name: dirent.name,
                path: entryPath,
                isDirectory: false,
              });
            }
          }
        }
      }

      // Sort: directories first, then files, alphabetically within each group
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      const response: FileBrowseResponse = {
        entries,
        currentPath: resolvedPath,
        selectedPath: null,
      };

      res.json(response);
    } catch (err) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to browse files',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}

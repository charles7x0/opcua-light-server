/**
 * Express application factory.
 * Assembles the Express app with JSON body parsing, auth middleware,
 * all route modules, static file serving for the Web UI, and a global error handler.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Database } from '../db/database.js';
import type { ProcessManager } from '../process-manager/index.js';
import type { ConfigGenerator } from '../config-generator/index.js';
import type { S7Connector } from '../s7-connector/index.js';
import type { AuthConfig } from '../auth/config.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import { NodeRepository } from '../db/repositories/node-repository.js';
import { NamespaceRepository } from '../db/repositories/namespace-repository.js';
import { SecurityRepository } from '../db/repositories/security-repository.js';
import { S7Repository } from '../db/repositories/s7-repository.js';
import { createNodeRoutes } from './routes/nodes.js';
import { createNamespaceRouter } from './routes/namespaces.js';
import { createObjectNodeRouter } from './routes/object-nodes.js';
import { createServerRouter } from './routes/server.js';
import { createSecurityRouter } from './routes/security.js';
import { createS7Router } from './routes/s7.js';
import { logService } from '../log/index.js';
import type { ErrorResponse } from '../types/api.js';

/** Dependencies required to create the Express application. */
export interface AppDependencies {
  database: Database;
  processManager: ProcessManager;
  configGenerator: ConfigGenerator;
  s7Connector?: S7Connector;
  authConfig: AuthConfig;
}

/**
 * Creates and configures the Express application with all routes and middleware.
 *
 * Auth middleware is applied to all routes except GET /api/server/status,
 * which is unauthenticated for health monitoring.
 */
export function createApp(deps: AppDependencies): Express {
  const { database, processManager, configGenerator, s7Connector, authConfig } = deps;

  const app = express();

  // ─── Body Parsing ───────────────────────────────────────────────────────────
  app.use(express.json());

  // ─── Repositories ───────────────────────────────────────────────────────────
  const nodeRepo = new NodeRepository(database);
  const namespaceRepo = new NamespaceRepository(database);
  const securityRepo = new SecurityRepository(database);
  const s7Repo = new S7Repository(database);

  // ─── Auth Middleware ────────────────────────────────────────────────────────
  // The server status endpoint must be unauthenticated (requirement 11.4).
  // The auth middleware already allows all GET requests through, so GET /api/server/status
  // is inherently unauthenticated. We apply auth globally to enforce on mutating endpoints.
  const authMiddleware = createAuthMiddleware(authConfig);
  app.use('/api', authMiddleware);

  // ─── Auto-Reload Runtime on Address Space Changes ───────────────────────────
  // Before route handlers: hook into res.end so that after any successful
  // mutating request to nodes, object-nodes, or namespaces, we regenerate
  // the config and signal the runtime to reload (if it's running).
  const CONFIG_FILE_PATH = 'runtime/config.json';
  const addressSpacePaths = ['/api/nodes', '/api/object-nodes', '/api/namespaces', '/api/s7/mappings'];

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();

    const isAddressSpaceChange = addressSpacePaths.some((p) => req.originalUrl.startsWith(p));
    if (!isAddressSpaceChange) return next();

    // Hook into response finish event to trigger reload after successful mutation
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const status = processManager.getStatus();
        if (status.state === 'running') {
          try {
            configGenerator.writeToFile(CONFIG_FILE_PATH);
            processManager.reload().catch(() => {
              // Silently ignore reload failures
            });
          } catch {
            // Silently ignore config generation failures
          }
        }
      }
    });

    next();
  });

  // ─── Route Modules ──────────────────────────────────────────────────────────
  app.use('/api/nodes', createNodeRoutes(nodeRepo));
  app.use('/api/namespaces', createNamespaceRouter(namespaceRepo));

  // Object node router handles both /api/object-nodes and /api/namespaces/:id/object-nodes
  const objectNodeRouter = createObjectNodeRouter(database);
  app.use('/api', objectNodeRouter);

  app.use('/api/server', createServerRouter({ processManager, configGenerator, s7Connector }));
  app.use('/api/security', createSecurityRouter(securityRepo));
  app.use('/api/s7', createS7Router(s7Repo, s7Connector));

  // ─── System Logs Endpoint ───────────────────────────────────────────────────
  app.get('/api/logs', (req: Request, res: Response) => {
    const since = req.query.since as string | undefined;
    const level = req.query.level as string | undefined;
    const source = req.query.source as string | undefined;
    const entries = logService.getEntries({ since, level, source });
    res.json(entries);
  });

  // ─── Static File Serving (Web UI) ───────────────────────────────────────────
  // Serve the built React app from web/dist/ at the root path.
  // Resolve the path relative to the project root (two levels up from src/api/).
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const webDistPath = path.resolve(__dirname, '../../web/dist');

  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));

    // SPA fallback: non-API routes serve index.html for client-side routing.
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      // Skip API routes — let them fall through to 404 or error handler
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  // ─── Global Error Handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    };
    res.status(500).json(errorResponse);
  });

  return app;
}

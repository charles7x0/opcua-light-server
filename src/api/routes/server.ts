/**
 * Server lifecycle API routes.
 * Provides endpoints to start, stop, reload, and check status of the OPC UA runtime.
 */

import { Router, type Request, type Response } from 'express';
import type { ProcessManager } from '../../process-manager/index.js';
import type { ConfigGenerator } from '../../config-generator/index.js';
import type { ConnectorRegistry } from '../../connectors/connector-registry.js';
import type { ErrorResponse, StartServerResponse, SuccessResponse } from '../../types/api.js';
import { logService } from '../../log/index.js';

/** Options for creating the server router. */
export interface ServerRouterOptions {
  processManager: ProcessManager;
  configGenerator: ConfigGenerator;
  connectorRegistry?: ConnectorRegistry;
  configFilePath?: string;
  /** OPC UA runtime port (included in status response). */
  opcuaPort?: number;
}

/**
 * Creates an Express Router with server lifecycle endpoints.
 *
 * Endpoints:
 * - POST /start   — Generate config and start the OPC UA runtime
 * - POST /stop    — Gracefully stop the OPC UA runtime
 * - POST /reload  — Regenerate config and reload the address space
 * - GET  /status  — Get current server status (unauthenticated)
 * - GET  /clients — Get connected client sessions (unauthenticated)
 */
export function createServerRouter(options: ServerRouterOptions): Router {
  const {
    processManager,
    configGenerator,
    connectorRegistry,
    configFilePath = 'runtime/config.json',
    opcuaPort = 4840,
  } = options;

  const router = Router();

  /**
   * POST /start
   * Generates the configuration file from the current database state,
   * then starts the OPC UA runtime process.
   */
  router.post('/start', async (req: Request, res: Response): Promise<void> => {
    try {
      // Generate config before starting
      configGenerator.writeToFile(configFilePath);

      const result = await processManager.start();

      // Start all connectors to begin polling active connections
      if (connectorRegistry) {
        connectorRegistry.startAll();
      }

      const response: StartServerResponse = {
        pid: result.pid,
        startedAt: result.startedAt.toISOString(),
      };

      logService.info('Runtime', `Server started (PID: ${result.pid})`);
      res.status(200).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start server';
      logService.error('Runtime', `Failed to start: ${message}`);

      if (message === 'Process is already running') {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'RUNTIME_ERROR',
            message: 'Server is already running',
          },
        };
        res.status(409).json(errorResponse);
        return;
      }

      const errorResponse: ErrorResponse = {
        error: {
          code: 'RUNTIME_ERROR',
          message,
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /stop
   * Gracefully stops the OPC UA runtime process.
   */
  router.post('/stop', async (req: Request, res: Response): Promise<void> => {
    try {
      // Stop all connector polling before stopping the runtime
      if (connectorRegistry) {
        connectorRegistry.stopAll();
      }

      await processManager.stop();

      const response: SuccessResponse = {
        success: true,
        message: 'Server stopped successfully',
      };

      logService.info('Runtime', 'Server stopped');
      res.status(200).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop server';

      if (message === 'Process is not running') {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'RUNTIME_ERROR',
            message: 'Server is not running',
          },
        };
        res.status(409).json(errorResponse);
        return;
      }

      const errorResponse: ErrorResponse = {
        error: {
          code: 'RUNTIME_ERROR',
          message,
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /reload
   * Regenerates the configuration file from the current database state,
   * then signals the runtime to reload the address space.
   */
  router.post('/reload', async (req: Request, res: Response): Promise<void> => {
    try {
      // Regenerate config before reloading
      configGenerator.writeToFile(configFilePath);

      await processManager.reload();

      const response: SuccessResponse = {
        success: true,
        message: 'Server configuration reloaded successfully',
      };

      logService.info('Runtime', 'Configuration reloaded');
      res.status(200).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reload server';

      if (message === 'Process is not running') {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'RUNTIME_ERROR',
            message: 'Server is not running, cannot reload',
          },
        };
        res.status(409).json(errorResponse);
        return;
      }

      const errorResponse: ErrorResponse = {
        error: {
          code: 'RUNTIME_ERROR',
          message,
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * GET /status
   * Returns the current server status. This endpoint is unauthenticated
   * per requirement 11.4 to allow health monitoring.
   */
  router.get('/status', (req: Request, res: Response): void => {
    try {
      const status = processManager.getStatus();
      status.opcuaPort = opcuaPort;
      res.status(200).json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get server status';
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message,
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * GET /clients
   * Returns an array of connected client sessions. This endpoint is unauthenticated
   * consistent with the existing status endpoint (Requirement 2.5).
   */
  router.get('/clients', (req: Request, res: Response): void => {
    try {
      const sessions = processManager.readClientSessions();
      res.status(200).json(sessions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get connected clients';
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message,
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}

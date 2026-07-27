/**
 * SSE events route.
 * Provides the GET /api/events endpoint that streams real-time
 * multiplexed events to connected clients via Server-Sent Events.
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { SseHub } from '../sse-hub.js';
import type { ProcessManager } from '../../process-manager/index.js';
import type { ConnectorRegistry } from '../../connectors/connector-registry.js';

/** Options for creating the events router. */
export interface EventsRouterOptions {
  sseHub: SseHub;
  processManager: ProcessManager;
  connectorRegistry?: ConnectorRegistry;
}

/**
 * Creates an Express Router with the SSE events endpoint.
 *
 * Endpoints:
 * - GET / — SSE stream delivering multiplexed real-time events
 *
 * This endpoint is unauthenticated, consistent with the existing
 * status and clients endpoints.
 */
export function createEventsRouter(options: EventsRouterOptions): Router {
  const { sseHub, processManager, connectorRegistry } = options;

  const router = Router();

  /**
   * GET /
   * Opens a persistent SSE connection. Sets appropriate headers,
   * registers the client with SseHub, sends initial state events,
   * and cleans up on disconnect.
   */
  router.get('/', (req: Request, res: Response): void => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Disable response buffering
    res.flushHeaders();

    // Generate unique client ID and register with SseHub
    const clientId = crypto.randomUUID();
    sseHub.addClient(clientId, res);

    // Send initial state events
    sendInitialState(clientId);

    // Clean up on client disconnect
    req.on('close', () => {
      sseHub.removeClient(clientId);
    });
  });

  /**
   * Sends initial state events to a newly connected client so it
   * has a complete view of the current system state without needing REST calls.
   */
  function sendInitialState(clientId: string): void {
    // Server status
    try {
      const status = processManager.getStatus();
      sseHub.sendToClient(clientId, 'server:status', status);
    } catch {
      // Silently ignore — client will receive next periodic update
    }

    // Connected client sessions
    try {
      const sessions = processManager.readClientSessions();
      sseHub.sendToClient(clientId, 'server:clients', sessions);
    } catch {
      // Silently ignore — client will receive next update
    }

    // Connector status and values (optional dependency)
    if (connectorRegistry) {
      try {
        const connectorStatus = connectorRegistry.getAggregatedStatus();
        sseHub.sendToClient(clientId, 'connector:status', connectorStatus);
      } catch {
        // Silently ignore
      }

      try {
        const connectorValues = connectorRegistry.getAggregatedValues();
        sseHub.sendToClient(clientId, 'connector:values', connectorValues);
      } catch {
        // Silently ignore
      }
    }
  }

  return router;
}

/**
 * SSE Hub — Central manager for Server-Sent Events connections.
 *
 * Manages connected SSE clients and broadcasts multiplexed events.
 * Follows the Observer pattern: internal services emit events via
 * broadcast(), and the hub relays them to all connected clients.
 */

import { EventEmitter } from 'events';
import type { Response } from 'express';

export interface SseClient {
  id: string;
  res: Response;
  connectedAt: Date;
}

export type SseEventType =
  | 'server:status'
  | 'server:clients'
  | 'log:entry'
  | 'connector:status'
  | 'connector:values';

const HEARTBEAT_INTERVAL_MS = 30_000;

export class SseHub extends EventEmitter {
  private clients: Map<string, SseClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /** Add a new SSE client connection. */
  addClient(id: string, res: Response): void {
    const client: SseClient = {
      id,
      res,
      connectedAt: new Date(),
    };
    this.clients.set(id, client);
    this.emit('clientAdded', id);
  }

  /** Remove a disconnected client and clean up. */
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;

    this.clients.delete(id);
    this.emit('clientRemoved', id);
  }

  /** Broadcast a named event to all connected clients. */
  broadcast(eventType: SseEventType, data: unknown): void {
    const payload = this.formatEvent(eventType, data);

    for (const [id, client] of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // Client likely disconnected — remove it
        this.removeClient(id);
      }
    }
  }

  /** Send a named event to a single client (for initial state). */
  sendToClient(id: string, eventType: SseEventType, data: unknown): void {
    const client = this.clients.get(id);
    if (!client) return;

    const payload = this.formatEvent(eventType, data);
    try {
      client.res.write(payload);
    } catch {
      // Client likely disconnected — remove it
      this.removeClient(id);
    }
  }

  /** Start the heartbeat timer (30s interval). */
  startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Stop the heartbeat and disconnect all clients. */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [id, client] of this.clients) {
      try {
        client.res.end();
      } catch {
        // Ignore errors during shutdown
      }
      this.clients.delete(id);
    }
  }

  /** Get the number of connected SSE clients. */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Format an event in SSE wire format. */
  private formatEvent(eventType: SseEventType, data: unknown): string {
    const json = JSON.stringify(data);
    return `event: ${eventType}\ndata: ${json}\n\n`;
  }

  /** Send heartbeat comment to all connected clients. */
  private sendHeartbeat(): void {
    for (const [id, client] of this.clients) {
      try {
        client.res.write(':heartbeat\n\n');
      } catch {
        // Client likely disconnected — remove it
        this.removeClient(id);
      }
    }
  }
}

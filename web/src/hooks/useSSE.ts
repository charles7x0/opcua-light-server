import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logStream } from './useLogStream';

export type SseConnectionState = 'connecting' | 'connected' | 'disconnected';

/** How long to wait before attempting reconnection after the EventSource gives up. */
const RECONNECT_DELAY_MS = 5_000;

/**
 * How long without a successful open before we consider the backend truly down.
 * The native EventSource retries every ~3s, so after 2 retries (~6s) without
 * success we show the disconnected state.
 */
const DISCONNECT_THRESHOLD_MS = 6_000;

export function useSSE(): { connectionState: SseConnectionState } {
  const [connectionState, setConnectionState] = useState<SseConnectionState>('connecting');
  const queryClient = useQueryClient();

  // Use refs to avoid re-running the effect
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function clearTimers(): void {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
    }

    function connect(): void {
      if (disposed) return;
      clearTimers();

      // Close any existing connection
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      const es = new EventSource('/api/events');
      eventSource = es;
      setConnectionState('connecting');

      // Start a timer — if we don't get `onopen` within the threshold,
      // consider it disconnected. This covers the case where EventSource
      // keeps retrying internally but never succeeds.
      disconnectTimer = setTimeout(() => {
        if (!disposed) {
          setConnectionState('disconnected');
        }
      }, DISCONNECT_THRESHOLD_MS);

      es.onopen = (): void => {
        if (disposed) return;
        // Clear the disconnect threshold timer — we're connected
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        setConnectionState('connected');
      };

      es.onerror = (): void => {
        if (disposed) return;

        // EventSource fires onerror when the connection drops.
        // If the EventSource readyState is CLOSED (2), the browser gave up
        // auto-reconnecting. In that case, we handle reconnection ourselves.
        if (es.readyState === EventSource.CLOSED) {
          setConnectionState('disconnected');
          eventSource = null;
          // Schedule manual reconnection
          reconnectTimer = setTimeout(() => {
            if (!disposed) connect();
          }, RECONNECT_DELAY_MS);
        } else {
          // readyState is CONNECTING (0) — the browser is auto-retrying.
          // Start the disconnect threshold timer if not already running.
          if (!disconnectTimer) {
            disconnectTimer = setTimeout(() => {
              if (!disposed) {
                setConnectionState('disconnected');
              }
            }, DISCONNECT_THRESHOLD_MS);
          }
        }
      };

      // Event-to-cache routing
      es.addEventListener('server:status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          queryClientRef.current.setQueryData(['serverStatus'], data);
          queryClientRef.current.setQueryData(['server-status'], data);
        } catch { /* ignore */ }
      });

      es.addEventListener('server:clients', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          queryClientRef.current.setQueryData(['server', 'clients'], data);
        } catch { /* ignore */ }
      });

      es.addEventListener('connector:status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          queryClientRef.current.setQueryData(['connectors-status'], data);
          queryClientRef.current.setQueryData(['s7-status'], data);
        } catch { /* ignore */ }
      });

      es.addEventListener('connector:values', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          queryClientRef.current.setQueryData(['connectors-values'], data);
          queryClientRef.current.setQueryData(['s7-values'], data);
        } catch { /* ignore */ }
      });

      es.addEventListener('log:entry', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          logStream.publish(data);
        } catch { /* ignore */ }
      });
    }

    connect();

    return (): void => {
      disposed = true;
      clearTimers();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, []); // No dependencies — runs once on mount, uses refs for mutable values

  // Fallback polling when disconnected
  useEffect(() => {
    if (connectionState === 'disconnected') {
      queryClient.setQueryDefaults(['serverStatus'], { refetchInterval: 5000 });
      queryClient.setQueryDefaults(['server-status'], { refetchInterval: 5000 });
      queryClient.setQueryDefaults(['server', 'clients'], { refetchInterval: 3000 });
      queryClient.setQueryDefaults(['connectors-status'], { refetchInterval: 5000 });
      queryClient.setQueryDefaults(['s7-status'], { refetchInterval: 5000 });
      queryClient.setQueryDefaults(['connectors-values'], { refetchInterval: 2000 });
      queryClient.setQueryDefaults(['s7-values'], { refetchInterval: 2000 });
    } else if (connectionState === 'connected') {
      queryClient.setQueryDefaults(['serverStatus'], { refetchInterval: false });
      queryClient.setQueryDefaults(['server-status'], { refetchInterval: false });
      queryClient.setQueryDefaults(['server', 'clients'], { refetchInterval: false });
      queryClient.setQueryDefaults(['connectors-status'], { refetchInterval: false });
      queryClient.setQueryDefaults(['s7-status'], { refetchInterval: false });
      queryClient.setQueryDefaults(['connectors-values'], { refetchInterval: false });
      queryClient.setQueryDefaults(['s7-values'], { refetchInterval: false });
    }
  }, [connectionState, queryClient]);

  return { connectionState };
}

import { useEffect, useRef } from 'react';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

export type LogListener = (entry: LogEntry) => void;

/**
 * Lightweight pub/sub for log entries from the SSE stream.
 * The useSSE hook publishes to this, and LogPanel subscribes via useLogStream.
 */
class LogStream {
  private listeners: Set<LogListener> = new Set();

  subscribe(listener: LogListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: LogListener): void {
    this.listeners.delete(listener);
  }

  publish(entry: LogEntry): void {
    for (const listener of this.listeners) {
      listener(entry);
    }
  }
}

/** Singleton log stream instance. useSSE publishes here, LogPanel subscribes. */
export const logStream = new LogStream();

/**
 * React hook to subscribe to real-time log entries from the SSE stream.
 * The provided callback fires for each new log entry.
 */
export function useLogStream(onEntry: LogListener): void {
  const callbackRef = useRef(onEntry);
  callbackRef.current = onEntry;

  useEffect(() => {
    const handler: LogListener = (entry) => {
      callbackRef.current(entry);
    };

    logStream.subscribe(handler);
    return () => {
      logStream.unsubscribe(handler);
    };
  }, []);
}

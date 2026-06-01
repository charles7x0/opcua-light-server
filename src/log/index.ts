/**
 * System-wide in-memory log service.
 * Any module can write log entries. The API exposes them for the web UI.
 */

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

const MAX_ENTRIES = 1000;

class LogService {
  private entries: LogEntry[] = [];

  /**
   * Add a log entry.
   */
  log(level: LogEntry['level'], source: string, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  info(source: string, message: string): void { this.log('info', source, message); }
  warn(source: string, message: string): void { this.log('warn', source, message); }
  error(source: string, message: string): void { this.log('error', source, message); }
  debug(source: string, message: string): void { this.log('debug', source, message); }

  /**
   * Get log entries, optionally filtered by since timestamp, level, or source.
   */
  getEntries(options?: { since?: string; level?: string; source?: string }): LogEntry[] {
    let result = this.entries;

    if (options?.since) {
      result = result.filter((e) => e.timestamp > options.since!);
    }
    if (options?.level) {
      const levels = options.level.split(',');
      result = result.filter((e) => levels.includes(e.level));
    }
    if (options?.source) {
      const sources = options.source.split(',');
      result = result.filter((e) => sources.includes(e.source));
    }

    return result;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }
}

/** Singleton log service instance. */
export const logService = new LogService();

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getServerStatus, getSystemLogs, getSecurityConfig, type ServerStatus, type LogEntry, type SecurityConfig } from '../api';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export type CertificateHealthColor = 'green' | 'yellow' | 'red';

export function getCertificateHealthColor(remainingDays: number): CertificateHealthColor {
  if (remainingDays > 90) return 'green';
  if (remainingDays >= 30) return 'yellow';
  return 'red';
}

const CERT_COLOR_CLASSES: Record<CertificateHealthColor, string> = {
  green: 'text-green-500',
  yellow: 'text-yellow-500',
  red: 'text-red-500',
};

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function LogPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error']));
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastTimestampRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let active = true;

    async function fetchLogs() {
      try {
        const newLogs = await getSystemLogs({ since: lastTimestampRef.current });
        if (!active) return;
        if (newLogs.length > 0) {
          setLogs((prev) => [...prev, ...newLogs].slice(-1000));
          lastTimestampRef.current = newLogs[newLogs.length - 1].timestamp;
        }
      } catch {
        // ignore
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [open]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }

  function toggleLevel(level: LogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  if (!open) return null;

  const filteredLogs = logs.filter((e) => activeLevels.has(e.level));

  const levelColors: Record<LogLevel, string> = {
    debug: 'text-gray-400',
    info: 'text-green-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
  };

  const levelBtnColors: Record<LogLevel, { active: string; inactive: string }> = {
    debug: { active: 'bg-gray-600 text-gray-200', inactive: 'text-gray-500 hover:text-gray-300' },
    info: { active: 'bg-green-800 text-green-200', inactive: 'text-gray-500 hover:text-gray-300' },
    warn: { active: 'bg-yellow-800 text-yellow-200', inactive: 'text-gray-500 hover:text-gray-300' },
    error: { active: 'bg-red-800 text-red-200', inactive: 'text-gray-500 hover:text-gray-300' },
  };

  return (
    <div className="fixed bottom-7 left-0 right-0 z-40 border-t border-gray-700">
      <div className="flex items-center justify-between px-3 py-1 bg-gray-800 text-gray-300 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">System Log</span>
          {/* Level filters */}
          <div className="flex items-center gap-0.5 ml-2">
            {ALL_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                  activeLevels.has(level) ? levelBtnColors[level].active : levelBtnColors[level].inactive
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <span className="text-gray-500 ml-2">{filteredLogs.length} entries</span>
        </div>
        <div className="flex items-center gap-3">
          {!autoScroll && (
            <button onClick={() => setAutoScroll(true)} className="text-blue-400 hover:text-blue-300">
              ↓ Auto-scroll
            </button>
          )}
          <button onClick={() => { setLogs([]); lastTimestampRef.current = undefined; }} className="text-gray-400 hover:text-gray-200">
            Clear
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            ✕
          </button>
        </div>
      </div>
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="h-48 overflow-y-auto px-3 py-1 font-mono text-xs bg-gray-900 text-gray-200"
      >
        {filteredLogs.length === 0 ? (
          <p className="text-gray-500 py-4 text-center font-sans">No log entries matching the selected filters.</p>
        ) : (
          filteredLogs.map((entry, i) => (
            <div key={i} className="py-0.5 leading-tight">
              <span className="text-gray-500">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>{' '}
              <span className="text-cyan-300">{entry.source}</span>{' '}
              <span className={levelColors[entry.level]}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function StatusBar() {
  const [logOpen, setLogOpen] = useState(false);

  const { data: status, isError } = useQuery<ServerStatus>({
    queryKey: ['server-status'],
    queryFn: getServerStatus,
    refetchInterval: 3000,
    retry: 1,
  });

  const { data: securityConfig } = useQuery<SecurityConfig>({
    queryKey: ['security'],
    queryFn: getSecurityConfig,
    refetchInterval: 30000,
    retry: 1,
  });

  const backendConnected = !isError && !!status;
  const runtimeState = status?.state ?? 'unknown';

  return (
    <>
      <LogPanel open={logOpen} onClose={() => setLogOpen(false)} />
      <footer className="fixed bottom-0 left-0 right-0 h-7 bg-gray-800 text-gray-300 text-xs flex items-center px-3 gap-4 z-50 select-none border-t border-gray-700">
        {/* Backend connection */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${backendConnected ? 'bg-green-400' : 'bg-red-500'}`}
          />
          <span>API: {backendConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Runtime status */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              runtimeState === 'running'
                ? 'bg-green-400'
                : runtimeState === 'error'
                  ? 'bg-red-500'
                  : 'bg-yellow-400'
            }`}
          />
          <span>
            Runtime: {runtimeState === 'running' ? 'Running' : runtimeState === 'error' ? 'Error' : 'Stopped'}
          </span>
        </div>

        {/* Uptime */}
        {status?.state === 'running' && status.uptime !== undefined && (
          <div className="flex items-center gap-1.5">
            <span>⏱ {formatUptime(status.uptime)}</span>
          </div>
        )}

        {/* Connected clients */}
        {status?.state === 'running' && (
          <div className="flex items-center gap-1.5">
            <span>👥 {status.connectedClients ?? 0} client{(status.connectedClients ?? 0) !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Certificate days remaining */}
        {securityConfig?.certificateRemainingDays != null && (
          <div className="flex items-center gap-1.5">
            <span className={CERT_COLOR_CLASSES[securityConfig.certificateRemainingDays === 0 ? 'red' : getCertificateHealthColor(securityConfig.certificateRemainingDays)]}>
              {securityConfig.certificateRemainingDays === 0 ? '🔒 Expired' : `🔒 ${securityConfig.certificateRemainingDays}d`}
            </span>
          </div>
        )}

        {/* Log toggle */}
        <button
          onClick={() => setLogOpen(!logOpen)}
          className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-700 ${logOpen ? 'bg-gray-700 text-white' : ''}`}
        >
          📋 Log
        </button>

        {/* Last error */}
        {status?.lastError && (
          <div className="text-red-400 truncate max-w-xs" title={status.lastError}>
            ⚠ {status.lastError}
          </div>
        )}
      </footer>
    </>
  );
}

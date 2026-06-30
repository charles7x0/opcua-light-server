import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getServerStatus, getSecurityConfig, type ServerStatus, type SecurityConfig } from '../api';
import { formatUptime } from '../utils/formatUptime';
import { LogPanel } from './LogPanel';

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

      <footer role="contentinfo" aria-label="Server status" className="fixed bottom-0 left-0 right-0 h-7 bg-gray-800 text-gray-300 text-xs flex items-center px-3 gap-4 z-50 select-none border-t border-gray-700">
        {/* Backend connection */}
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${backendConnected ? 'bg-green-400' : 'bg-red-500'}`} />
          <span>API: {backendConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Runtime status */}
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
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
            <span aria-label={`Uptime: ${formatUptime(status.uptime)}`}>
              <span aria-hidden="true">⏱</span> {formatUptime(status.uptime)}
            </span>
          </div>
        )}

        {/* Connected clients */}
        {status?.state === 'running' && (
          <div className="flex items-center gap-1.5">
            <span aria-label={`${status.connectedClients ?? 0} connected client${(status.connectedClients ?? 0) !== 1 ? 's' : ''}`}>
              <span aria-hidden="true">👥</span> {status.connectedClients ?? 0} client{(status.connectedClients ?? 0) !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Certificate days remaining */}
        {securityConfig?.certificateRemainingDays != null && (
          <div className="flex items-center gap-1.5">
            <span
              aria-label={`Certificate ${securityConfig.certificateRemainingDays === 0 ? 'expired' : `expires in ${securityConfig.certificateRemainingDays} days`}`}
              className={CERT_COLOR_CLASSES[securityConfig.certificateRemainingDays === 0 ? 'red' : getCertificateHealthColor(securityConfig.certificateRemainingDays)]}
            >
              <span aria-hidden="true">🔒</span> {securityConfig.certificateRemainingDays === 0 ? 'Expired' : `${securityConfig.certificateRemainingDays}d`}
            </span>
          </div>
        )}

        {/* Log toggle */}
        <button
          onClick={() => setLogOpen(!logOpen)}
          aria-expanded={logOpen}
          aria-label={logOpen ? 'Close system log' : 'Open system log'}
          className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-700 ${logOpen ? 'bg-gray-700 text-white' : ''}`}
        >
          <span aria-hidden="true">📋</span> Log
        </button>

        {/* Last error */}
        {status?.lastError && (
          <div role="alert" className="text-red-400 truncate max-w-xs" title={status.lastError}>
            <span aria-hidden="true">⚠</span> {status.lastError}
          </div>
        )}
      </footer>
    </>
  );
}

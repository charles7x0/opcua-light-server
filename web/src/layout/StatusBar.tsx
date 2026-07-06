import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getServerStatus, getSecurityConfig, type ServerStatus, type SecurityConfig } from '../api';
import { formatUptime } from '../utils/formatUptime';
import { StatusDot, StatusBarItem, StatusBarAlert, Button } from '../components';
import { type StatusDotColor } from '../components/styles';
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

function getRuntimeDotColor(state: string): StatusDotColor {
  if (state === 'running') return 'green';
  if (state === 'error') return 'red';
  return 'yellow';
}

function getRuntimeLabel(state: string): string {
  if (state === 'running') return 'Running';
  if (state === 'error') return 'Error';
  return 'Stopped';
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

      <footer role="contentinfo" aria-label="Server status" className="fixed bottom-0 left-0 right-0 h-7 bg-gray-800 text-gray-300 text-xs flex items-center px-3 gap-4 z-50 select-none border-t border-gray-700">
        {/* Backend connection */}
        <StatusDot color={backendConnected ? 'green' : 'red'}>
          API: {backendConnected ? 'Connected' : 'Disconnected'}
        </StatusDot>

        {/* Runtime status */}
        <StatusDot color={getRuntimeDotColor(runtimeState)}>
          Runtime: {getRuntimeLabel(runtimeState)}
        </StatusDot>

        {/* Uptime */}
        {status?.state === 'running' && status.uptime !== undefined && (
          <StatusBarItem icon="⏱" label={`Uptime: ${formatUptime(status.uptime)}`}>
            {formatUptime(status.uptime)}
          </StatusBarItem>
        )}

        {/* Connected clients */}
        {status?.state === 'running' && (
          <StatusBarItem
            icon="👥"
            label={`${status.connectedClients ?? 0} connected client${(status.connectedClients ?? 0) !== 1 ? 's' : ''}`}
          >
            {status.connectedClients ?? 0} client{(status.connectedClients ?? 0) !== 1 ? 's' : ''}
          </StatusBarItem>
        )}

        {/* Certificate days remaining */}
        {securityConfig?.certificateRemainingDays != null && (
          <StatusBarItem
            icon="🔒"
            label={`Certificate ${securityConfig.certificateRemainingDays === 0 ? 'expired' : `expires in ${securityConfig.certificateRemainingDays} days`}`}
            className={CERT_COLOR_CLASSES[securityConfig.certificateRemainingDays === 0 ? 'red' : getCertificateHealthColor(securityConfig.certificateRemainingDays)]}
          >
            {securityConfig.certificateRemainingDays === 0 ? 'Expired' : `${securityConfig.certificateRemainingDays}d`}
          </StatusBarItem>
        )}

        {/* Log toggle */}
        <Button
          variant="ghost-dark"
          size="xs"
          onClick={() => setLogOpen(!logOpen)}
          aria-expanded={logOpen}
          aria-label={logOpen ? 'Close system log' : 'Open system log'}
          className={`ml-auto ${logOpen ? 'bg-gray-700 text-white' : ''}`}
        >
          <span aria-hidden="true">📋</span> Log
        </Button>

        {/* Last error */}
        {status?.lastError && (
          <StatusBarAlert title={status.lastError}>
            {status.lastError}
          </StatusBarAlert>
        )}
      </footer>
    </>
  );
}

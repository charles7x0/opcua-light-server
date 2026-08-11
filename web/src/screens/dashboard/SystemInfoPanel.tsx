import { useMemo } from 'react';
import { useServerStatus } from '../../hooks/useServerStatus';
import { useSecurityConfig } from '../../hooks/useSecurityConfig';
import { Card, CardHeader, CopyButton, CardPlaceholder } from '../../components';

/**
 * Build the OPC UA endpoint URL from the server-reported hostname and port.
 */
function getEndpointUrl(hostname: string, port: number): string {
  return `opc.tcp://${hostname}:${port}`;
}

/** Get the Control API base URL. */
function getApiUrl(): string {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

/** Detect auth mode from localStorage configuration. */
function detectAuthMode(): string {
  const apiKey = localStorage.getItem('opcua-api-key');
  if (apiKey) return 'API Key';
  return 'None';
}

export function SystemInfoPanel() {
  const { data: status, isLoading: loadingStatus } = useServerStatus();
  const { data: security, isLoading: loadingSecurity } = useSecurityConfig();

  const serverHostname = status?.hostname ?? window.location.hostname;
  const opcuaPort = status?.opcuaPort ?? 4840;
  const endpointUrl = getEndpointUrl(serverHostname, opcuaPort);
  const apiUrl = getApiUrl();
  const authMode = useMemo(() => detectAuthMode(), []);

  const isLoading = loadingStatus || loadingSecurity;

  if (isLoading) {
    return <CardPlaceholder title="System Info" message="Loading..." animate />;
  }

  return (
    <Card>
      <CardHeader>System Info</CardHeader>
      <dl className="space-y-2.5">
        <SystemInfoRow label="OPC UA Endpoint" value={endpointUrl} copyable />
        <SystemInfoRow label="Control API" value={apiUrl} />
        <SystemInfoRow label="Auth Mode" value={authMode} />
        <SystemInfoRow label="Security Mode" value={security?.mode ?? '—'} />
        {status?.pid && (
          <SystemInfoRow label="Runtime PID" value={String(status.pid)} />
        )}
      </dl>
    </Card>
  );
}

interface SystemInfoRowProps {
  label: string;
  value: string;
  copyable?: boolean;
}

function SystemInfoRow({ label, value, copyable }: SystemInfoRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-medium text-gray-900 truncate font-mono" title={value}>{value}</span>
        {copyable && <CopyButton value={value} label={`Copy ${label}`} />}
      </dd>
    </div>
  );
}

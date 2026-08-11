import { useQuery } from '@tanstack/react-query';
import { getConnectedClients } from '../../api';
import { useServerStatus } from '../../hooks/useServerStatus';
import { Alert, Card } from '../../components';
import { ServerIdentityStrip } from './ServerIdentityStrip';
import { ConnectorHealthPanel } from './ConnectorHealthPanel';
import { CertificateHealthPanel } from './CertificateHealthPanel';
import { AddressSpaceSummaryPanel } from './AddressSpaceSummaryPanel';
import { SystemInfoPanel } from './SystemInfoPanel';
import { ConnectedClientsTable } from './ConnectedClientsTable';

export function Dashboard() {
  const { data: status, isLoading, isError } = useServerStatus();

  const { data: clients = [] } = useQuery({
    queryKey: ['server', 'clients'],
    queryFn: getConnectedClients,
    enabled: status?.state === 'running',
  });

  if (isLoading) {
    return (
      <Card>
        <p className="text-gray-500" role="status" aria-live="polite">Loading server status...</p>
      </Card>
    );
  }

  if (isError || !status) {
    return (
      <Alert variant="error">
        Failed to fetch server status. Is the Control API running?
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Server Identity + Controls */}
      <ServerIdentityStrip status={status} />

      {/* Connectors - full width */}
      <ConnectorHealthPanel />

      {/* Three-column info panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <CertificateHealthPanel />
        <AddressSpaceSummaryPanel />
        <SystemInfoPanel />
      </div>

      {/* Connected Clients */}
      {status.state === 'running' && (
        <section aria-label="Connected OPC UA clients">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-900">
              Connected Clients
              {clients.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">({clients.length})</span>
              )}
            </h3>
          </div>
          <ConnectedClientsTable sessions={clients} />
        </section>
      )}
    </div>
  );
}

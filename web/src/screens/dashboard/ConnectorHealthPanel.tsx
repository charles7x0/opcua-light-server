import { useQuery } from '@tanstack/react-query';
import { getConnections, getConnectorStatus, type ConnectorConnection, type ConnectorStatus } from '../../api';
import { Card, CardHeader, Badge, CardPlaceholder } from '../../components';

const CONNECTOR_STATE_VARIANT: Record<ConnectorStatus['state'], 'green' | 'red' | 'gray'> = {
  connected: 'green',
  disconnected: 'gray',
  error: 'red',
};

const CONNECTOR_STATE_LABEL: Record<ConnectorStatus['state'], string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

const CONNECTOR_STATE_DOT: Record<ConnectorStatus['state'], string> = {
  connected: 'bg-success-500',
  disconnected: 'bg-gray-400',
  error: 'bg-danger-500',
};

export function ConnectorHealthPanel() {
  const { data: connections = [], isLoading, isError } = useQuery({
    queryKey: ['connector-connections'],
    queryFn: () => getConnections(),
  });

  const { data: statuses = [] } = useQuery({
    queryKey: ['connectors-status'],
    queryFn: getConnectorStatus,
  });

  if (isLoading) {
    return <CardPlaceholder title="Connectors" message="Loading..." animate />;
  }

  if (isError) {
    return <CardPlaceholder title="Connectors" message="Unable to load connectors" />;
  }

  if (connections.length === 0) {
    return <CardPlaceholder title="Connectors" message="No connectors configured" />;
  }

  const statusMap = new Map(statuses.map((s) => [s.connectionId, s]));
  const connectedCount = statuses.filter((s) => s.state === 'connected').length;

  return (
    <Card>
      <CardHeader>Connectors</CardHeader>
      <ul className="space-y-2" aria-label="Connector health list">
        {connections.map((conn) => (
          <ConnectorRow
            key={conn.id}
            connection={conn}
            status={statusMap.get(conn.id)}
          />
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        {connectedCount}/{connections.length} connected
      </p>
    </Card>
  );
}

interface ConnectorRowProps {
  connection: ConnectorConnection;
  status?: ConnectorStatus;
}

function ConnectorRow({ connection, status }: ConnectorRowProps) {
  const state = status?.state ?? 'disconnected';

  return (
    <li className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${CONNECTOR_STATE_DOT[state]}`} aria-hidden="true" />
        <span className="text-sm text-gray-900 truncate">{connection.name}</span>
        <span className="text-xs text-gray-400 flex-shrink-0">({connection.type})</span>
      </div>
      <Badge variant={CONNECTOR_STATE_VARIANT[state]}>{CONNECTOR_STATE_LABEL[state]}</Badge>
    </li>
  );
}

import { ClientSession } from '../../api';
import { formatRelativeDuration } from '../../utils/formatRelativeDuration';
import { Badge, Card } from '../../components';

interface ConnectedClientsTableProps {
  sessions: ClientSession[];
}

export function ConnectedClientsTable({ sessions }: ConnectedClientsTableProps) {
  if (sessions.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500">No clients connected</p>
      </Card>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              App Name
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              App URI
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Security Policy
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Address
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Connected
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              State
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sessions.map((session, index) => (
            <tr key={`${session.clientAddress}-${index}`}>
              <td className="px-3 py-2 text-sm text-gray-900">
                {session.applicationName}
              </td>
              <td className="px-3 py-2 text-sm text-gray-700 font-mono">
                {session.applicationUri}
              </td>
              <td className="px-3 py-2 text-sm text-gray-700">
                {session.securityPolicyUri}
              </td>
              <td className="px-3 py-2 text-sm text-gray-700 font-mono">
                {session.clientAddress}
              </td>
              <td className="px-3 py-2 text-sm text-gray-700">
                {formatRelativeDuration(session.connectTime)}
              </td>
              <td className="px-3 py-2">
                <SessionStateBadge state={session.sessionState} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionStateBadge({ state }: { state: ClientSession['sessionState'] }) {
  const variantMap: Record<ClientSession['sessionState'], 'blue' | 'green' | 'yellow'> = {
    Created: 'blue',
    Activated: 'green',
    Closing: 'yellow',
  };

  return <Badge variant={variantMap[state]}>{state}</Badge>;
}

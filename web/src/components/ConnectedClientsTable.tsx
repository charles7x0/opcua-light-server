import { ClientSession } from '../api';
import { formatRelativeDuration } from '../utils/formatRelativeDuration';

interface ConnectedClientsTableProps {
  sessions: ClientSession[];
}

export function ConnectedClientsTable({ sessions }: ConnectedClientsTableProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">No clients connected</p>
      </div>
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
  const styles: Record<ClientSession['sessionState'], string> = {
    Created: 'bg-blue-100 text-blue-800',
    Activated: 'bg-green-100 text-green-800',
    Closing: 'bg-yellow-100 text-yellow-800',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[state]}`}>
      {state}
    </span>
  );
}

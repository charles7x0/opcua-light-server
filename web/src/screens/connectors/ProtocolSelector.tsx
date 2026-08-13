import { useQuery } from '@tanstack/react-query';

import { fetchProtocols, ConnectorMetadata } from '../../api';
import { Button } from '../../components';

interface ProtocolSelectorProps {
  onSelect: (type: string) => void;
  onCancel: () => void;
}

export function ProtocolSelector({ onSelect, onCancel }: ProtocolSelectorProps) {
  const { data: protocols = [], isLoading, isError } = useQuery<ConnectorMetadata[]>({
    queryKey: ['connectors', 'protocols'],
    queryFn: fetchProtocols,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Select Protocol</h3>
        <p className="text-sm text-gray-500">Loading available protocols…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Select Protocol</h3>
        <p className="text-sm text-red-600">Failed to load protocols. Please try again.</p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">Select Protocol</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {protocols.map((protocol) => (
          <button
            key={protocol.type}
            type="button"
            onClick={() => onSelect(protocol.type)}
            className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-6 text-center hover:border-primary-300 hover:bg-primary-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            aria-label={`Select ${protocol.displayName} protocol`}
          >
            <span className="text-3xl" aria-hidden="true">{protocol.icon ?? '🔌'}</span>
            <span className="text-sm font-semibold text-gray-900">{protocol.displayName}</span>
            <span className="text-xs text-gray-500">{protocol.description ?? ''}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

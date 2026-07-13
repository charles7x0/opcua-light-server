import { Button } from '../../components';

interface ProtocolOption {
  type: string;
  label: string;
  description: string;
  icon: string;
}

interface ProtocolSelectorProps {
  onSelect: (type: string) => void;
  onCancel: () => void;
}

const PROTOCOLS: ProtocolOption[] = [
  { type: 's7', label: 'Siemens S7', description: 'Connect to S7-300/400/1200/1500 PLCs', icon: '🔌' },
  { type: 'modbus-tcp', label: 'Modbus TCP', description: 'Connect to Modbus TCP devices', icon: '📡' },
  { type: 'ethernet-ip', label: 'EtherNet/IP', description: 'Connect to Rockwell/Allen-Bradley PLCs', icon: '🏭' },
];

export function ProtocolSelector({ onSelect, onCancel }: ProtocolSelectorProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">Select Protocol</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PROTOCOLS.map((protocol) => (
          <button
            key={protocol.type}
            type="button"
            onClick={() => onSelect(protocol.type)}
            className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-6 text-center hover:border-primary-300 hover:bg-primary-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            aria-label={`Select ${protocol.label} protocol`}
          >
            <span className="text-3xl" aria-hidden="true">{protocol.icon}</span>
            <span className="text-sm font-semibold text-gray-900">{protocol.label}</span>
            <span className="text-xs text-gray-500">{protocol.description}</span>
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

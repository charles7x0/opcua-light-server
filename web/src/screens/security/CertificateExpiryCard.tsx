import { SecurityConfig } from '../../api';
import { Card, CardHeader } from '../../components';

interface CertificateExpiryCardProps {
  config: SecurityConfig;
}

export function CertificateExpiryCard({ config }: CertificateExpiryCardProps) {
  const hasExpiry = config.certificateExpiresAt != null && config.certificateRemainingDays != null;

  return (
    <Card>
      <CardHeader>Certificate Expiry</CardHeader>
      {hasExpiry ? (
        <dl className="space-y-2">
          <div className="flex items-center gap-2">
            <dt className="text-sm text-gray-500">Remaining Days:</dt>
            <dd>
              {config.certificateRemainingDays === 0 ? (
                <span className="text-sm font-semibold text-danger-600" role="status">Expired</span>
              ) : config.certificateRemainingDays! < 30 ? (
                <span className="text-sm font-semibold text-danger-600">
                  {config.certificateRemainingDays} <span className="sr-only">(expires soon — critical)</span>
                </span>
              ) : config.certificateRemainingDays! <= 90 ? (
                <span className="text-sm font-semibold text-warning-600">
                  {config.certificateRemainingDays} <span className="sr-only">(expiring soon — warning)</span>
                </span>
              ) : (
                <span className="text-sm font-semibold text-success-600">{config.certificateRemainingDays}</span>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-sm text-gray-500">Expires At:</dt>
            <dd className="text-sm text-gray-700">{config.certificateExpiresAt!.split('T')[0]}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-gray-500">No certificate expiry data available</p>
      )}
    </Card>
  );
}

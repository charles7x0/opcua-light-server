import { useSecurityConfig } from '../../hooks/useSecurityConfig';
import { Card, CardHeader, Badge, InfoRow, CardPlaceholder } from '../../components';

function getCertBadgeVariant(days: number | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (days == null) return 'gray';
  if (days > 90) return 'green';
  if (days >= 30) return 'yellow';
  return 'red';
}

function getCertLabel(days: number | undefined): string {
  if (days == null) return 'Not configured';
  if (days === 0) return 'Expired';
  return `${days} days remaining`;
}

export function CertificateHealthPanel() {
  const { data: security, isLoading, isError } = useSecurityConfig();

  if (isLoading) {
    return <CardPlaceholder title="Security" message="Loading..." animate />;
  }

  if (isError) {
    return <CardPlaceholder title="Security" message="Unable to load security config" />;
  }

  const days = security?.certificateRemainingDays;
  const mode = security?.mode ?? 'None';
  const valid = security?.certificateValid;

  return (
    <Card>
      <CardHeader>Security</CardHeader>
      <div className="space-y-3">
        <InfoRow label="Mode">{mode}</InfoRow>

        <InfoRow label="Certificate">
          <Badge variant={getCertBadgeVariant(days)}>
            {getCertLabel(days)}
          </Badge>
        </InfoRow>

        {valid != null && (
          <InfoRow label="Valid">
            <Badge variant={valid ? 'green' : 'red'}>
              {valid ? 'Yes' : 'No'}
            </Badge>
          </InfoRow>
        )}
      </div>
    </Card>
  );
}

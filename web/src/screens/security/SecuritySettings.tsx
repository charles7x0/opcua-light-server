import { useQuery } from '@tanstack/react-query';
import { getSecurityConfig, SecurityConfig } from '../../api';
import { Alert } from '../../components';
import { SecurityModeCard } from './SecurityModeCard';
import { CertificateExpiryCard } from './CertificateExpiryCard';
import { CertificateStatusCard } from './CertificateStatusCard';
import { GenerateCertificateCard } from './GenerateCertificateCard';
import { UploadCertificateCard } from './UploadCertificateCard';
import { CertificatePanel } from './CertificatePanel';

export function SecuritySettings() {
  const {
    data: config,
    isLoading,
    error: fetchError,
  } = useQuery<SecurityConfig>({
    queryKey: ['security'],
    queryFn: getSecurityConfig,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading security configuration...</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-6">
        <Alert variant="error">
          Failed to load security configuration: {fetchError instanceof Error ? fetchError.message : 'Unknown error'}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Security Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure OPC UA security mode and certificates.
        </p>
      </div>

      <SecurityModeCard currentMode={config?.mode} />
      {config && <CertificateExpiryCard config={config} />}
      {config && <CertificateStatusCard config={config} />}
      <GenerateCertificateCard hasCertificate={!!config?.certificatePath} />
      <UploadCertificateCard />
      <CertificatePanel />
    </div>
  );
}

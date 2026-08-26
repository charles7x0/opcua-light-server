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

  const hasCertificate = !!config?.certificatePath;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Security Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure OPC UA transport security between clients and the runtime.
        </p>
      </div>

      {/* Security mode is the primary decision — always at the top */}
      <SecurityModeCard currentMode={config?.mode} hasCertificate={hasCertificate} />

      {/* Certificate details (only relevant when a cert exists) */}
      {config && <CertificateStatusCard config={config} />}
      {config && <CertificateExpiryCard config={config} />}

      {/* Certificate management */}
      <GenerateCertificateCard hasCertificate={hasCertificate} />
      <UploadCertificateCard />

      {/* Client certificate trust (TOFU) */}
      <CertificatePanel />
    </div>
  );
}

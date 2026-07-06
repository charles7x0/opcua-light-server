import { useState } from 'react';
import { SecurityConfig, getCertificateDownloadUrl } from '../../api';
import { Button, Select, Card, CardHeader, Alert } from '../../components';

interface CertificateStatusCardProps {
  config: SecurityConfig;
}

export function CertificateStatusCard({ config }: CertificateStatusCardProps) {
  const [downloadFormat, setDownloadFormat] = useState<'der' | 'pem'>('der');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadCertificate = async (): Promise<void> => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const url = getCertificateDownloadUrl(downloadFormat === 'pem' ? 'pem' : undefined);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download certificate');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>Certificate Status</CardHeader>
      <dl className="space-y-3">
        <div className="flex items-center gap-2">
          <dt className="text-sm text-gray-500">Certificate:</dt>
          <dd>
            {config.certificatePath ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${config.certificateValid ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-700">{config.certificateValid ? 'Valid' : 'Invalid'}</span>
              </span>
            ) : (
              <span className="text-sm text-gray-400">Not configured</span>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-sm text-gray-500">Private Key:</dt>
          <dd>
            {config.privateKeyConfigured ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-gray-700">Configured</span>
              </span>
            ) : (
              <span className="text-sm text-gray-400">Not configured</span>
            )}
          </dd>
        </div>
        {config.certificatePath && (
          <div className="flex items-start gap-2">
            <dt className="text-sm text-gray-500">Path:</dt>
            <dd className="text-sm text-gray-700 font-mono break-all">{config.certificatePath}</dd>
          </div>
        )}
      </dl>

      {/* Download Certificate Controls */}
      <div className="mt-4 flex items-center gap-3">
        <Select
          value={downloadFormat}
          onChange={(e) => setDownloadFormat(e.target.value as 'der' | 'pem')}
          disabled={!config.certificatePath || !config.certificateValid}
          aria-label="Certificate format"
          className="mt-0 w-auto"
        >
          <option value="der">DER</option>
          <option value="pem">PEM</option>
        </Select>
        {config.certificatePath && config.certificateValid && (
          <Button onClick={handleDownloadCertificate} loading={isDownloading}>
            Download Certificate
          </Button>
        )}
      </div>
      {downloadError && <Alert variant="error" className="mt-2">{downloadError}</Alert>}
    </Card>
  );
}

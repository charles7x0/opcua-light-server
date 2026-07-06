import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadCertificate, browseFiles, ApiError } from '../../api';
import { Button, Input, FormField, Card, CardHeader, Alert } from '../../components';

export function UploadCertificateCard() {
  const queryClient = useQueryClient();
  const [certificatePath, setCertificatePath] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const certificateMutation = useMutation({
    mutationFn: () => uploadCertificate(certificatePath, privateKeyPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security'] });
      setCertificatePath('');
      setPrivateKeyPath('');
      setUploadError(null);
    },
    onError: (err: Error) => {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to upload certificate');
    },
  });

  const handleBrowseCertificate = async (): Promise<void> => {
    const result = await browseFiles({ extensions: ['.der', '.pem', '.crt'] });
    if (result.selectedPath !== null) {
      setCertificatePath(result.selectedPath);
    }
  };

  const handleBrowsePrivateKey = async (): Promise<void> => {
    const result = await browseFiles({ extensions: ['.key', '.pem'] });
    if (result.selectedPath !== null) {
      setPrivateKeyPath(result.selectedPath);
    }
  };

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!certificatePath.trim() || !privateKeyPath.trim()) {
      setUploadError('Both certificate path and private key path are required');
      return;
    }
    setUploadError(null);
    certificateMutation.mutate();
  }

  return (
    <Card>
      <CardHeader>Upload Certificate</CardHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        {uploadError && <Alert variant="error">{uploadError}</Alert>}

        <FormField id="certificatePath" label="Certificate file path">
          <div className="flex gap-2">
            <Input
              id="certificatePath"
              value={certificatePath}
              onChange={(e) => setCertificatePath(e.target.value)}
              placeholder="/path/to/server.der"
              className="flex-1"
            />
            <Button variant="secondary" type="button" onClick={handleBrowseCertificate}>
              Browse
            </Button>
          </div>
        </FormField>

        <FormField id="privateKeyPath" label="Private key file path">
          <div className="flex gap-2">
            <Input
              id="privateKeyPath"
              value={privateKeyPath}
              onChange={(e) => setPrivateKeyPath(e.target.value)}
              placeholder="/path/to/server.key"
              className="flex-1"
            />
            <Button variant="secondary" type="button" onClick={handleBrowsePrivateKey}>
              Browse
            </Button>
          </div>
        </FormField>

        <Button type="submit" loading={certificateMutation.isPending}>
          Upload Certificate
        </Button>
      </form>
    </Card>
  );
}

import { request, BASE_URL } from './client';

export interface SecurityConfig {
  mode: 'None' | 'Sign' | 'SignAndEncrypt';
  certificatePath?: string;
  certificateValid?: boolean;
  privateKeyConfigured: boolean;
  certificateExpiresAt?: string;
  certificateRemainingDays?: number;
}

export interface GenerateCertificateOptions {
  dnsNames?: string[];
  ipAddresses?: string[];
  organization?: string;
  country?: string;
  commonName?: string;
  force?: boolean;
}

export function getSecurityConfig(): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security');
}

export function updateSecurityPolicy(mode: string): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security/policy', { method: 'PUT', body: JSON.stringify({ mode }) });
}

export function uploadCertificate(certificatePath: string, privateKeyPath: string): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security/certificate', {
    method: 'POST',
    body: JSON.stringify({ certificatePath, privateKeyPath }),
  });
}

export function generateCertificate(options: GenerateCertificateOptions = {}): Promise<SecurityConfig> {
  return request<SecurityConfig>('/security/generate', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export function getCertificateDownloadUrl(format?: 'der' | 'pem'): string {
  const base = `${BASE_URL}/security/certificate/download`;
  if (format === 'pem') {
    return `${base}?format=pem`;
  }
  return base;
}

export function browseFiles(options?: { startPath?: string; extensions?: string[] }): Promise<{ selectedPath: string | null }> {
  return request<{ selectedPath: string | null }>('/files/browse', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

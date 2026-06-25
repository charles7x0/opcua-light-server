import { request } from './client';

export interface PkiCertificate {
  thumbprint: string;
  status: 'trusted' | 'rejected';
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fileSize: number;
}

export function getPkiCertificates(): Promise<PkiCertificate[]> {
  return request<PkiCertificate[]>('/pki/certificates');
}

export function rejectPkiCertificate(thumbprint: string): Promise<void> {
  return request<void>(`/pki/certificates/${thumbprint}/reject`, { method: 'POST' });
}

export function trustPkiCertificate(thumbprint: string): Promise<void> {
  return request<void>(`/pki/certificates/${thumbprint}/trust`, { method: 'POST' });
}

export function deletePkiCertificate(thumbprint: string): Promise<void> {
  return request<void>(`/pki/certificates/${thumbprint}`, { method: 'DELETE' });
}

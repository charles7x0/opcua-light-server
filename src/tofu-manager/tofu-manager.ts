import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import forge from 'node-forge';
import type { ProcessManager } from '../process-manager/index.js';
import type { CertificateInfo } from './index.js';
import { logService } from '../log/index.js';

/**
 * TOFU (Trust On First Use) client certificate manager.
 * Manages the PKI directory structure, persists client certificates,
 * and exposes trust/reject operations.
 */
export class TofuManager {
  private readonly trustedPath: string;
  private readonly rejectedPath: string;

  constructor(
    private readonly pkiBasePath: string = 'data/pki',
    private readonly processManager: ProcessManager
  ) {
    this.trustedPath = resolve(this.pkiBasePath, 'trusted');
    this.rejectedPath = resolve(this.pkiBasePath, 'rejected');
  }

  /**
   * Create the PKI directory structure if it doesn't exist.
   * Creates data/pki/, data/pki/trusted/, and data/pki/rejected/.
   * Existing directories and their contents are left unchanged.
   * Throws on failure — callers should prevent runtime start.
   */
  async initialize(): Promise<void> {
    try {
      mkdirSync(this.trustedPath, { recursive: true });
      mkdirSync(this.rejectedPath, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logService.error('TofuManager', `Failed to create PKI directories: ${message}`);
      throw err;
    }
  }

  /**
   * List all certificates from both trusted and rejected stores.
   * Parses each .der file to extract subject, issuer, and validity info.
   * Malformed files are skipped with a warning log.
   * Returns sorted array by thumbprint ascending.
   */
  listCertificates(): CertificateInfo[] {
    const certificates: CertificateInfo[] = [];

    const trustedFiles = this.readDerFiles(this.trustedPath);
    for (const file of trustedFiles) {
      const info = this.parseCertificateFile(this.trustedPath, file, 'trusted');
      if (info) {
        certificates.push(info);
      }
    }

    const rejectedFiles = this.readDerFiles(this.rejectedPath);
    for (const file of rejectedFiles) {
      const info = this.parseCertificateFile(this.rejectedPath, file, 'rejected');
      if (info) {
        certificates.push(info);
      }
    }

    certificates.sort((a, b) => a.thumbprint.localeCompare(b.thumbprint));
    return certificates;
  }

  /**
   * Delete a certificate from whichever store it resides in.
   * Checks trusted store first, then rejected store.
   * Throws with code 'NOT_FOUND' if the thumbprint is not in either store.
   * Lets filesystem errors (unlink failures) propagate as-is.
   */
  deleteCertificate(thumbprint: string): void {
    const trustedFile = resolve(this.trustedPath, `${thumbprint}.der`);
    const rejectedFile = resolve(this.rejectedPath, `${thumbprint}.der`);

    let filePath: string;

    try {
      statSync(trustedFile);
      filePath = trustedFile;
    } catch {
      try {
        statSync(rejectedFile);
        filePath = rejectedFile;
      } catch {
        const error = new Error(`Certificate not found: ${thumbprint}`);
        (error as any).code = 'NOT_FOUND';
        throw error;
      }
    }

    unlinkSync(filePath);
    logService.info('TofuManager', `Certificate deleted: ${thumbprint}`);
    this.signalReload();
  }

  /**
   * Move a certificate from the trust store to the reject store.
   * Throws an error with code 'NOT_FOUND' if the thumbprint doesn't exist in the trust store.
   * Lets filesystem errors propagate (mapped to 500 at API layer).
   */
  rejectCertificate(thumbprint: string): void {
    const sourcePath = resolve(this.trustedPath, `${thumbprint}.der`);
    if (!existsSync(sourcePath)) {
      const error = new Error(`Certificate not found in trust store: ${thumbprint}`);
      (error as any).code = 'NOT_FOUND';
      throw error;
    }

    const destPath = resolve(this.rejectedPath, `${thumbprint}.der`);
    renameSync(sourcePath, destPath);
    logService.info('TofuManager', `Certificate rejected: ${thumbprint}`);
    this.signalReload();
  }

  /**
   * Read all .der filenames from a directory.
   * Returns an empty array if the directory is unreadable.
   */
  private readDerFiles(dirPath: string): string[] {
    try {
      const entries = readdirSync(dirPath);
      return entries.filter((entry) => entry.endsWith('.der'));
    } catch {
      return [];
    }
  }

  /**
   * Parse a single DER certificate file and return CertificateInfo.
   * Returns null if the file cannot be read or parsed.
   */
  private parseCertificateFile(
    dirPath: string,
    filename: string,
    status: 'trusted' | 'rejected'
  ): CertificateInfo | null {
    const filePath = resolve(dirPath, filename);
    const thumbprint = filename.replace(/\.der$/, '');

    try {
      const derBuffer = readFileSync(filePath);
      const fileStats = statSync(filePath);

      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(derBuffer.toString('binary')));
      const cert = forge.pki.certificateFromAsn1(asn1);

      const subject = cert.subject.getField('CN')?.value || 'Unknown';
      const issuer = cert.issuer.getField('CN')?.value || 'Unknown';
      const notBefore = cert.validity.notBefore.toISOString();
      const notAfter = cert.validity.notAfter.toISOString();

      return {
        thumbprint,
        status,
        subject,
        issuer,
        notBefore,
        notAfter,
        fileSize: fileStats.size,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logService.warn('TofuManager', `Skipping malformed certificate file ${filename}: ${message}`);
      return null;
    }
  }

  /**
   * Move a certificate from the reject store to the trust store.
   * Throws an error with code 'NOT_FOUND' if the thumbprint is not in the reject store.
   * Throws an error with code 'CONFLICT' if the thumbprint already exists in the trust store.
   * Signals a trust store reload after successful move.
   */
  trustCertificate(thumbprint: string): void {
    const rejectedFile = resolve(this.rejectedPath, `${thumbprint}.der`);
    const trustedFile = resolve(this.trustedPath, `${thumbprint}.der`);

    if (!existsSync(rejectedFile)) {
      const error = new Error(`Certificate ${thumbprint} not found in reject store`);
      (error as any).code = 'NOT_FOUND';
      throw error;
    }

    if (existsSync(trustedFile)) {
      const error = new Error(`Certificate ${thumbprint} is already trusted`);
      (error as any).code = 'CONFLICT';
      throw error;
    }

    renameSync(rejectedFile, trustedFile);
    logService.info('TofuManager', `Certificate re-trusted: ${thumbprint}`);
    this.signalReload();
  }

  /**
   * Get absolute paths for the trust and reject directories.
   */
  getPkiPaths(): { trustedPath: string; rejectedPath: string } {
    return {
      trustedPath: this.trustedPath,
      rejectedPath: this.rejectedPath,
    };
  }

  /**
   * Send trust_store_reload signal to the runtime if running.
   * Called after trust/reject/delete operations to notify the runtime of changes.
   * If the runtime is not running, logs deferral and skips the signal.
   */
  signalReload(): void {
    const status = this.processManager.getStatus();
    if (status.state !== 'running') {
      logService.info('TofuManager', 'Runtime not running, skipping reload signal');
      return;
    }
    const ok = this.processManager.writeToStdin(
      JSON.stringify({ type: 'trust_store_reload' }) + '\n'
    );
    if (!ok) {
      logService.warn('TofuManager', 'Failed to write reload signal to stdin');
    }
  }
}

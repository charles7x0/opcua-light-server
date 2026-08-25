/**
 * Security API routes.
 * GET /api/security - Get security config (never expose private key contents)
 * PUT /api/security/policy - Set security mode (None, Sign, SignAndEncrypt)
 * POST /api/security/certificate - Upload certificate (validate format, store paths)
 * POST /api/security/generate - Generate self-signed certificate and auto-configure
 */

import { Router, Request, Response } from 'express';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { SecurityRepository } from '../../db/repositories/security-repository.js';
import { generateCertificate } from '../../cert-generator/index.js';
import { validateGenerateRequest } from '../../cert-generator/validation.js';
import { derToPem } from '../../cert-generator/cert-utils.js';
import type { ErrorResponse, UpdateSecurityPolicyRequest, UploadCertificateRequest, GenerateCertificateRequest } from '../../types/api.js';
import type { ProcessManager } from '../../process-manager/index.js';
import type { ConfigGenerator } from '../../config-generator/index.js';
import type { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import { logService } from '../../log/index.js';
import { networkInterfaces } from 'os';

export interface SecurityRouterDeps {
  processManager?: ProcessManager;
  configGenerator?: ConfigGenerator;
  connectorRegistry?: ConnectorRegistry;
  configFilePath?: string;
}

/**
 * Creates the security router with the given dependencies.
 */
export function createSecurityRouter(securityRepo: SecurityRepository, deps?: SecurityRouterDeps): Router {
  const processManager = deps?.processManager;
  const configGenerator = deps?.configGenerator;
  const connectorRegistry = deps?.connectorRegistry;
  const configFilePath = deps?.configFilePath ?? 'runtime/config.json';
  const router = Router();

  /**
   * GET /api/security
   * Returns the current security configuration.
   * Never exposes private key contents in the response.
   */
  router.get('/', (_req: Request, res: Response): void => {
    try {
      const config = securityRepo.get();
      res.json(config);
    } catch (err) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to retrieve security configuration',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * GET /api/security/certificate/download
   * Downloads the server's public certificate in DER or PEM format.
   * The file path is read from the database — no user-supplied paths accepted.
   */
  router.get('/certificate/download', (req: Request, res: Response): void => {
    try {
      // Validate format query parameter (case-insensitive, default to 'der')
      const formatParam = (req.query.format as string | undefined)?.toLowerCase() ?? 'der';
      if (formatParam !== 'der' && formatParam !== 'pem') {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid format. Valid options: der, pem',
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Retrieve certificate path from database
      const certPath = securityRepo.getCertificatePath();
      if (!certPath) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'CERTIFICATE_NOT_FOUND',
            message: 'No certificate is available for download',
          },
        };
        res.status(404).json(errorResponse);
        return;
      }

      // Reject path traversal sequences
      const pathTraversalPatterns = ['../', '..\\', '%2e%2e/', '%2e%2e\\'];
      const certPathLower = certPath.toLowerCase();
      if (pathTraversalPatterns.some((pattern) => certPathLower.includes(pattern))) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied',
          },
        };
        res.status(403).json(errorResponse);
        return;
      }

      // Check if file exists
      if (!existsSync(certPath)) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'CERTIFICATE_NOT_FOUND',
            message: 'Certificate file not found at configured path',
          },
        };
        res.status(404).json(errorResponse);
        return;
      }

      // Read certificate file
      let derBuffer: Buffer;
      try {
        derBuffer = readFileSync(certPath);
      } catch {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to read certificate file',
          },
        };
        res.status(500).json(errorResponse);
        return;
      }

      // Serve based on format
      if (formatParam === 'pem') {
        const pemContent = derToPem(derBuffer);
        res.setHeader('Content-Type', 'application/x-pem-file');
        res.setHeader('Content-Disposition', 'attachment; filename="server.pem"');
        res.send(pemContent);
      } else {
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="server.der"');
        res.send(derBuffer);
      }
    } catch (err) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to download certificate',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * PUT /api/security/policy
   * Updates the security mode (None, Sign, SignAndEncrypt).
   */
  router.put('/policy', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as UpdateSecurityPolicyRequest;

      // Validate mode field is present
      if (!body || !body.mode) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Security mode is required',
            details: [{ field: 'mode', message: 'Mode is required' }],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Validate mode value
      const validModes = ['None', 'Sign', 'SignAndEncrypt'] as const;
      if (!validModes.includes(body.mode as typeof validModes[number])) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid security mode: ${body.mode}. Must be one of: ${validModes.join(', ')}`,
            details: [{ field: 'mode', message: `Must be one of: ${validModes.join(', ')}` }],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const config = securityRepo.updatePolicy(body.mode);

      // Security mode changes require a full runtime restart because
      // open62541 endpoint filtering is only applied at server creation time.
      if (processManager && configGenerator) {
        const status = processManager.getStatus();
        if (status.state === 'running') {
          try {
            // Stop connectors before runtime shutdown
            connectorRegistry?.stopAll();

            configGenerator.writeToFile(configFilePath);
            await processManager.stop();
            await processManager.start();

            // Restart connectors after runtime is back up
            connectorRegistry?.startAll();

            logService.info('Security', `Runtime restarted after security mode change to "${body.mode}"`);
          } catch (err) {
            logService.warn('Security', `Failed to restart runtime after policy change: ${(err as Error).message}`);
          }
        }
      }

      res.json(config);
    } catch (err) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to update security policy',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/security/certificate
   * Uploads certificate and private key paths.
   * Validates certificate path format before storing.
   */
  router.post('/certificate', (req: Request, res: Response): void => {
    try {
      const body = req.body as UploadCertificateRequest;

      // Validate required fields
      const details: { field: string; message: string }[] = [];

      if (!body || !body.certificatePath || body.certificatePath.trim().length === 0) {
        details.push({ field: 'certificatePath', message: 'Certificate path is required' });
      }

      if (!body || !body.privateKeyPath || body.privateKeyPath.trim().length === 0) {
        details.push({ field: 'privateKeyPath', message: 'Private key path is required' });
      }

      if (details.length > 0) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Certificate upload validation failed',
            details,
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Validate certificate path format (must end with a recognized certificate extension)
      const validCertExtensions = ['.pem', '.der', '.crt', '.cer'];
      const certPath = body.certificatePath.trim().toLowerCase();
      const hasValidCertExtension = validCertExtensions.some((ext) => certPath.endsWith(ext));

      if (!hasValidCertExtension) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid certificate format',
            details: [
              {
                field: 'certificatePath',
                message: `Certificate file must have one of these extensions: ${validCertExtensions.join(', ')}`,
              },
            ],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Validate private key path format (must end with a recognized key extension)
      const validKeyExtensions = ['.pem', '.key', '.der'];
      const keyPath = body.privateKeyPath.trim().toLowerCase();
      const hasValidKeyExtension = validKeyExtensions.some((ext) => keyPath.endsWith(ext));

      if (!hasValidKeyExtension) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid private key format',
            details: [
              {
                field: 'privateKeyPath',
                message: `Private key file must have one of these extensions: ${validKeyExtensions.join(', ')}`,
              },
            ],
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const config = securityRepo.updateCertificate(
        body.certificatePath.trim(),
        body.privateKeyPath.trim()
      );
      res.json(config);
    } catch (err) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to upload certificate',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/security/generate
   * Generates a self-signed certificate and private key, stores them in ./data/certs/,
   * and auto-configures the security_config table with the new paths.
   * Requires force=true in body to overwrite existing certificate files.
   */
  router.post('/generate', (req: Request, res: Response): void => {
    try {
      const body = (req.body ?? {}) as GenerateCertificateRequest;

      // Trim whitespace on all string inputs before validation
      const trimmedBody: GenerateCertificateRequest = {
        ...body,
        commonName: typeof body.commonName === 'string' ? body.commonName.trim() : body.commonName,
        organization: typeof body.organization === 'string' ? body.organization.trim() : body.organization,
        country: typeof body.country === 'string' ? body.country.trim() : body.country,
        dnsNames: Array.isArray(body.dnsNames)
          ? body.dnsNames.map((d) => (typeof d === 'string' ? d.trim() : d))
          : body.dnsNames,
        ipAddresses: Array.isArray(body.ipAddresses)
          ? body.ipAddresses.map((ip) => (typeof ip === 'string' ? ip.trim() : ip))
          : body.ipAddresses,
      };

      // Run input validation and return all errors aggregated
      const validationErrors = validateGenerateRequest(trimmedBody);
      if (validationErrors.length > 0) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: validationErrors.map((e) => ({ field: e.field, message: e.message })),
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Handle force field: treat non-boolean values as not set
      const force = body.force === true;

      // Check certificate existence — reject if exists and force !== true
      const certPath = resolve('data/certs/server.der');
      if (existsSync(certPath) && !force) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Certificate already exists. Set force=true to overwrite.',
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Auto-detect IP addresses from network interfaces when not provided
      const detectedIps = getLocalIpAddresses();
      const ipAddresses = trimmedBody.ipAddresses && trimmedBody.ipAddresses.length > 0
        ? trimmedBody.ipAddresses
        : detectedIps;

      const dnsNames = trimmedBody.dnsNames ?? [];

      // Generate certificate
      const certOutputPath = resolve('data/certs/server.der');
      const keyOutputPath = resolve('data/certs/server.key');

      const result = generateCertificate(certOutputPath, keyOutputPath, {
        dnsNames,
        ipAddresses,
        organization: trimmedBody.organization,
        country: trimmedBody.country,
        commonName: trimmedBody.commonName,
      });

      // Auto-apply: update security_config with the new paths
      securityRepo.updateCertificate(result.certificatePath, result.privateKeyPath);

      // Return the updated security config (includes expiry info)
      const config = securityRepo.get();
      res.status(201).json(config);
    } catch (err) {
      // On generation failure, return 500 — security_config table is NOT modified
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: `Certificate generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}

/**
 * Detect local non-loopback IPv4 addresses from network interfaces.
 * Always includes 127.0.0.1 for localhost access.
 */
function getLocalIpAddresses(): string[] {
  const ips = new Set<string>(['127.0.0.1']);

  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.add(addr.address);
      }
    }
  }

  return Array.from(ips);
}

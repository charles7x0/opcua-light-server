/**
 * Security API routes.
 * GET /api/security - Get security config (never expose private key contents)
 * PUT /api/security/policy - Set security mode (None, Sign, SignAndEncrypt)
 * POST /api/security/certificate - Upload certificate (validate format, store paths)
 */

import { Router, Request, Response } from 'express';
import { SecurityRepository } from '../../db/repositories/security-repository.js';
import type { ErrorResponse, UpdateSecurityPolicyRequest, UploadCertificateRequest } from '../../types/api.js';

/**
 * Creates the security router with the given SecurityRepository instance.
 */
export function createSecurityRouter(securityRepo: SecurityRepository): Router {
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
   * PUT /api/security/policy
   * Updates the security mode (None, Sign, SignAndEncrypt).
   */
  router.put('/policy', (req: Request, res: Response): void => {
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

  return router;
}

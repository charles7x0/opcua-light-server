/**
 * PKI (Public Key Infrastructure) certificate management API routes.
 * GET /api/pki/certificates - List all client certificates (unauthenticated)
 * POST /api/pki/certificates/:thumbprint/reject - Reject a trusted certificate
 * POST /api/pki/certificates/:thumbprint/trust - Re-trust a rejected certificate
 * DELETE /api/pki/certificates/:thumbprint - Permanently delete a certificate
 */

import { Router, Request, Response, NextFunction } from 'express';
import type { TofuManager } from '../../tofu-manager/index.js';
import { isValidThumbprint } from '../../tofu-manager/index.js';
import type { ErrorResponse } from '../../types/api.js';

/**
 * Middleware that validates the :thumbprint path parameter.
 * Returns 400 with VALIDATION_ERROR if the thumbprint is not a valid
 * 40-character lowercase hexadecimal string.
 * Uses the router.param callback signature which provides the param value directly.
 */
function validateThumbprint(req: Request, res: Response, next: NextFunction, value: string): void {
  if (!isValidThumbprint(value)) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid thumbprint format. Must be 40 lowercase hex characters.',
      },
    };
    res.status(400).json(errorResponse);
    return;
  }

  next();
}

/**
 * Creates the PKI router with the given TofuManager instance.
 * Routes are mounted at /api/pki/certificates by the app.
 */
export function createPkiRouter(tofuManager: TofuManager): Router {
  const router = Router();

  // Apply thumbprint validation to all routes with :thumbprint parameter
  router.param('thumbprint', validateThumbprint);

  // ─── GET / ─────────────────────────────────────────────────────────────────
  // List all certificates (no authentication required)
  router.get('/', (_req: Request, res: Response): void => {
    const certificates = tofuManager.listCertificates();
    res.json(certificates);
  });

  // ─── POST /:thumbprint/reject ──────────────────────────────────────────────
  // Reject a trusted certificate (requires authentication)
  router.post('/:thumbprint/reject', (req: Request, res: Response): void => {
    const thumbprint = req.params.thumbprint as string;
    try {
      tofuManager.rejectCertificate(thumbprint);
      res.sendStatus(204);
    } catch (err: any) {
      if (err.code === 'NOT_FOUND') {
        const errorResponse: ErrorResponse = {
          error: { code: 'NOT_FOUND', message: err.message },
        };
        res.status(404).json(errorResponse);
      } else {
        const errorResponse: ErrorResponse = {
          error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to reject certificate' },
        };
        res.status(500).json(errorResponse);
      }
    }
  });

  // ─── POST /:thumbprint/trust ───────────────────────────────────────────────
  // Re-trust a rejected certificate (requires authentication)
  router.post('/:thumbprint/trust', (req: Request, res: Response): void => {
    const thumbprint = req.params.thumbprint as string;
    try {
      tofuManager.trustCertificate(thumbprint);
      res.sendStatus(204);
    } catch (err: any) {
      if (err.code === 'NOT_FOUND') {
        const errorResponse: ErrorResponse = {
          error: { code: 'NOT_FOUND', message: err.message },
        };
        res.status(404).json(errorResponse);
      } else if (err.code === 'CONFLICT') {
        const errorResponse: ErrorResponse = {
          error: { code: 'CONFLICT', message: err.message },
        };
        res.status(409).json(errorResponse);
      } else {
        const errorResponse: ErrorResponse = {
          error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to trust certificate' },
        };
        res.status(500).json(errorResponse);
      }
    }
  });

  // ─── DELETE /:thumbprint ───────────────────────────────────────────────────
  // Permanently delete a certificate (requires authentication)
  router.delete('/:thumbprint', (req: Request, res: Response): void => {
    const thumbprint = req.params.thumbprint as string;
    try {
      tofuManager.deleteCertificate(thumbprint);
      res.sendStatus(204);
    } catch (err: any) {
      if (err.code === 'NOT_FOUND') {
        const errorResponse: ErrorResponse = {
          error: { code: 'NOT_FOUND', message: err.message },
        };
        res.status(404).json(errorResponse);
      } else {
        const errorResponse: ErrorResponse = {
          error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to delete certificate' },
        };
        res.status(500).json(errorResponse);
      }
    }
  });

  return router;
}

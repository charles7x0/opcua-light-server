import { Router, Request, Response } from 'express';
import type { NamespaceRepository } from '../../db/repositories/namespace-repository.js';
import type { CreateNamespaceRequest, UpdateNamespaceRequest, ErrorResponse } from '../../types/api.js';

/**
 * Creates an Express Router for namespace CRUD endpoints.
 * Endpoints:
 *   POST   /api/namespaces      - Create namespace
 *   GET    /api/namespaces      - List namespaces (with node counts)
 *   PUT    /api/namespaces/:id  - Update namespace
 *   DELETE /api/namespaces/:id  - Delete namespace (cascade)
 */
export function createNamespaceRouter(repository: NamespaceRepository): Router {
  const router = Router();

  // POST /api/namespaces - Create a new namespace
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body as CreateNamespaceRequest;

      // Validate required fields
      const validationErrors: { field: string; message: string }[] = [];

      if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
        validationErrors.push({ field: 'name', message: 'Name is required and must be a non-empty string' });
      }

      if (!body.uri || typeof body.uri !== 'string' || body.uri.trim().length === 0) {
        validationErrors.push({ field: 'uri', message: 'URI is required and must be a non-empty string' });
      }

      if (validationErrors.length > 0) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid namespace definition',
            details: validationErrors,
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const result = repository.create(body);

      if (!result.success) {
        const statusCode = result.error.code === 'DUPLICATE_ERROR' ? 409 : 400;
        const errorResponse: ErrorResponse = {
          error: {
            code: result.error.code as ErrorResponse['error']['code'],
            message: result.error.message,
            details: result.error.details,
          },
        };
        res.status(statusCode).json(errorResponse);
        return;
      }

      res.status(201).json(result.data);
    } catch (error) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  // GET /api/namespaces - List all namespaces with node counts
  router.get('/', (_req: Request, res: Response) => {
    try {
      const namespaces = repository.findAll();
      res.status(200).json(namespaces);
    } catch (error) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  // PUT /api/namespaces/:id - Update an existing namespace
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const body = req.body as UpdateNamespaceRequest;

      // Validate that at least one field is provided
      if (!body.name && !body.uri && body.description === undefined) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'At least one field must be provided for update',
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Validate field types if provided
      const validationErrors: { field: string; message: string }[] = [];

      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0)) {
        validationErrors.push({ field: 'name', message: 'Name must be a non-empty string' });
      }

      if (body.uri !== undefined && (typeof body.uri !== 'string' || body.uri.trim().length === 0)) {
        validationErrors.push({ field: 'uri', message: 'URI must be a non-empty string' });
      }

      if (validationErrors.length > 0) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid namespace update',
            details: validationErrors,
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const result = repository.update(id, body);

      if (!result.success) {
        let statusCode: number;
        switch (result.error.code) {
          case 'NOT_FOUND':
            statusCode = 404;
            break;
          case 'DUPLICATE_ERROR':
            statusCode = 409;
            break;
          default:
            statusCode = 400;
        }

        const errorResponse: ErrorResponse = {
          error: {
            code: result.error.code as ErrorResponse['error']['code'],
            message: result.error.message,
            details: result.error.details,
          },
        };
        res.status(statusCode).json(errorResponse);
        return;
      }

      res.status(200).json(result.data);
    } catch (error) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  // DELETE /api/namespaces/:id - Delete a namespace (cascades folders and nodes)
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const result = repository.delete(id);

      if (!result.success) {
        const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
        const errorResponse: ErrorResponse = {
          error: {
            code: result.error.code as ErrorResponse['error']['code'],
            message: result.error.message,
            details: result.error.details,
          },
        };
        res.status(statusCode).json(errorResponse);
        return;
      }

      res.status(200).json({ success: true, message: 'Namespace deleted successfully' });
    } catch (error) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}

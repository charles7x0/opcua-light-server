import { Router, Request, Response } from 'express';
import { ObjectNodeRepository, ObjectNodeValidationError, ObjectNodeDuplicateError, ObjectNodeNotFoundError } from '../../db/repositories/object-node-repository.js';
import type { Database } from '../../db/database.js';
import type { CreateObjectNodeRequest, ErrorResponse } from '../../types/api.js';

/**
 * Creates an Express Router for object node management endpoints.
 * Object nodes are OPC UA Object nodes that use HasComponent references.
 */
export function createObjectNodeRouter(database: Database): Router {
  const router = Router();
  const repository = new ObjectNodeRepository(database);

  /**
   * POST /api/object-nodes
   * Create a new object node within a namespace.
   */
  router.post('/object-nodes', (req: Request, res: Response) => {
    try {
      const body = req.body as CreateObjectNodeRequest;

      // Validate required fields
      const validationErrors: { field: string; message: string }[] = [];

      if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        validationErrors.push({ field: 'name', message: 'Name is required and must be a non-empty string' });
      }

      if (!body.namespaceId || typeof body.namespaceId !== 'string' || body.namespaceId.trim() === '') {
        validationErrors.push({ field: 'namespaceId', message: 'Namespace ID is required and must be a non-empty string' });
      }

      if (validationErrors.length > 0) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid object node definition',
            details: validationErrors,
          },
        };
        res.status(400).json(errorResponse);
        return;
      }

      const objectNode = repository.create({
        name: body.name.trim(),
        namespaceId: body.namespaceId.trim(),
        parentObjectNodeId: body.parentObjectNodeId ?? null,
      });

      res.status(201).json(objectNode);
    } catch (error) {
      handleError(error, res);
    }
  });

  /**
   * GET /api/namespaces/:id/object-nodes
   * Get the object node tree for a namespace.
   */
  router.get('/namespaces/:id/object-nodes', (req: Request, res: Response) => {
    try {
      const namespaceId = req.params.id as string;
      const tree = repository.findTreeByNamespace(namespaceId);
      res.status(200).json(tree);
    } catch (error) {
      handleError(error, res);
    }
  });

  /**
   * DELETE /api/object-nodes/:id
   * Delete an object node. Reassigns contained variable nodes to parent or namespace root.
   */
  router.delete('/object-nodes/:id', (req: Request, res: Response) => {
    try {
      const objectNodeId = req.params.id as string;
      repository.delete(objectNodeId);
      res.status(200).json({ success: true, message: 'Object node deleted successfully' });
    } catch (error) {
      handleError(error, res);
    }
  });

  return router;
}

/**
 * Maps repository errors to appropriate HTTP error responses.
 */
function handleError(error: unknown, res: Response): void {
  if (error instanceof ObjectNodeValidationError) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
      },
    };
    res.status(400).json(errorResponse);
    return;
  }

  if (error instanceof ObjectNodeDuplicateError) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'DUPLICATE_ERROR',
        message: error.message,
      },
    };
    res.status(409).json(errorResponse);
    return;
  }

  if (error instanceof ObjectNodeNotFoundError) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: error.message,
      },
    };
    res.status(404).json(errorResponse);
    return;
  }

  const errorResponse: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  };
  res.status(500).json(errorResponse);
}

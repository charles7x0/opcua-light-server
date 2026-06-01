import { Router } from 'express';
import type { Request, Response } from 'express';
import type { NodeRepository } from '../../db/repositories/node-repository.js';
import type { ErrorResponse } from '../../types/api.js';
import type { CreateNodeRequest, UpdateNodeRequest } from '../../types/api.js';

/**
 * Creates the Express router for Node CRUD endpoints.
 */
export function createNodeRoutes(repository: NodeRepository): Router {
  const router = Router();

  // POST /api/nodes - Create a node
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body as CreateNodeRequest;
      const node = repository.create(body);
      res.status(201).json(node);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // GET /api/nodes - List nodes (optional ?namespaceId filter)
  router.get('/', (req: Request, res: Response) => {
    try {
      const namespaceId = typeof req.query.namespaceId === 'string'
        ? req.query.namespaceId
        : undefined;
      const nodes = repository.findAll(namespaceId);
      res.json(nodes);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // GET /api/nodes/:id - Get node by ID
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const node = repository.findById(id);
      if (!node) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'NOT_FOUND',
            message: `Node with id '${id}' not found`,
          },
        };
        res.status(404).json(errorResponse);
        return;
      }
      res.json(node);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // PUT /api/nodes/:id - Update a node
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const body = req.body as UpdateNodeRequest;
      const node = repository.update(id, body);
      res.json(node);
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  // DELETE /api/nodes/:id - Delete a node
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const deleted = repository.delete(id);
      if (!deleted) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'NOT_FOUND',
            message: `Node with id '${id}' not found`,
          },
        };
        res.status(404).json(errorResponse);
        return;
      }
      res.status(204).send();
    } catch (error: unknown) {
      handleRepositoryError(res, error);
    }
  });

  return router;
}

/**
 * Maps repository errors to appropriate HTTP error responses.
 */
function handleRepositoryError(res: Response, error: unknown): void {
  if (!(error instanceof Error)) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };
    res.status(500).json(errorResponse);
    return;
  }

  const err = error as Error & {
    validationErrors?: Array<{ field: string; message: string }>;
    isDuplicate?: boolean;
    isNotFound?: boolean;
  };

  if (err.isNotFound) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: err.message,
      },
    };
    res.status(404).json(errorResponse);
    return;
  }

  if (err.isDuplicate) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'DUPLICATE_ERROR',
        message: err.message,
        details: err.validationErrors,
      },
    };
    res.status(409).json(errorResponse);
    return;
  }

  if (err.validationErrors) {
    const errorResponse: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: err.validationErrors,
      },
    };
    res.status(400).json(errorResponse);
    return;
  }

  const errorResponse: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
    },
  };
  res.status(500).json(errorResponse);
}

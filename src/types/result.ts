/**
 * Shared Result type for repository operations.
 * Provides explicit, type-safe error handling without exceptions.
 */

/** Known domain error codes returned by repositories. */
export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

/** Structured domain error with optional field-level details. */
export interface DomainError {
  code: DomainErrorCode;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

/** Discriminated union for repository operation results. */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: DomainError };

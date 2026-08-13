import { ParamFieldSchema } from './types.js';

/** A single field validation error. */
export interface FieldError {
  field: string;
  message: string;
}

/** Validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
}

/**
 * Validate connection params against a paramsSchema.
 *
 * @param params - The params Record from the connection request
 * @param schema - The paramsSchema from the connector's metadata
 * @returns ValidationResult with per-field errors if invalid
 */
export function validateParams(
  params: Record<string, unknown>,
  schema: ParamFieldSchema[]
): ValidationResult {
  const errors: FieldError[] = [];

  for (const field of schema) {
    const value = params[field.key];

    // Required field check
    if (field.required) {
      if (value === undefined || value === null || value === '') {
        errors.push({ field: field.key, message: `${field.label} is required` });
        continue;
      }
    }

    // If value is not present and not required, skip further checks
    if (value === undefined || value === null || value === '') {
      continue;
    }

    // Type-specific validation
    switch (field.type) {
      case 'text':
        validateText(field, value, errors);
        break;
      case 'number':
        validateNumber(field, value, errors);
        break;
      case 'boolean':
        validateBoolean(field, value, errors);
        break;
      case 'select':
        validateSelect(field, value, errors);
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateText(field: ParamFieldSchema, value: unknown, errors: FieldError[]): void {
  if (typeof value !== 'string') {
    errors.push({ field: field.key, message: `${field.label} must be a string` });
    return;
  }

  if (field.pattern) {
    const regex = new RegExp(field.pattern);
    if (!regex.test(value)) {
      const message = field.patternMessage ?? `${field.label} does not match the required pattern`;
      errors.push({ field: field.key, message });
    }
  }
}

function validateNumber(field: ParamFieldSchema, value: unknown, errors: FieldError[]): void {
  let numValue: number;

  if (typeof value === 'number') {
    numValue = value;
  } else if (typeof value === 'string') {
    numValue = Number(value);
    if (isNaN(numValue)) {
      errors.push({ field: field.key, message: `${field.label} must be a valid number` });
      return;
    }
  } else {
    errors.push({ field: field.key, message: `${field.label} must be a valid number` });
    return;
  }

  if (field.min !== undefined && numValue < field.min) {
    errors.push({ field: field.key, message: `${field.label} must be at least ${field.min}` });
  }

  if (field.max !== undefined && numValue > field.max) {
    errors.push({ field: field.key, message: `${field.label} must be at most ${field.max}` });
  }
}

function validateBoolean(field: ParamFieldSchema, value: unknown, errors: FieldError[]): void {
  if (typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'string' && (value === 'true' || value === 'false')) {
    return;
  }

  errors.push({ field: field.key, message: `${field.label} must be a boolean` });
}

function validateSelect(field: ParamFieldSchema, value: unknown, errors: FieldError[]): void {
  if (typeof value !== 'string') {
    errors.push({ field: field.key, message: `${field.label} must be a string` });
    return;
  }

  const allowedValues = field.options?.map((opt) => opt.value) ?? [];

  if (!allowedValues.includes(value)) {
    errors.push({
      field: field.key,
      message: `${field.label} must be one of: ${allowedValues.join(', ')}`,
    });
  }
}

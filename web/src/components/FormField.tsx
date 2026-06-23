import { ReactNode } from 'react';

interface FormFieldProps {
  /** The input element's id — used for label htmlFor binding */
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  description?: string;
  children: ReactNode;
}

export function FormField({ id, label, required, error, description, children }: FormFieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const descId = description ? `${id}-desc` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span aria-hidden="true" className="text-red-500 ml-0.5">*</span>
        )}
      </label>
      {description && (
        <p id={descId} className="mt-0.5 text-xs text-gray-500">
          {description}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

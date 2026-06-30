import { ReactNode } from 'react';
import { FORM_LABEL, FORM_REQUIRED, FORM_DESCRIPTION, FORM_ERROR } from './styles';

interface FormFieldProps {
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
      <label htmlFor={id} className={FORM_LABEL}>
        {label}
        {required && <span aria-hidden="true" className={FORM_REQUIRED}>*</span>}
      </label>
      {description && <p id={descId} className={FORM_DESCRIPTION}>{description}</p>}
      {children}
      {error && <p id={errorId} role="alert" className={FORM_ERROR}>{error}</p>}
    </div>
  );
}

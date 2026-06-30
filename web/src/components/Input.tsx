import { InputHTMLAttributes, forwardRef } from 'react';
import { type InputSize, getFieldClasses } from './styles';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  inputSize?: InputSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, inputSize = 'md', className = '', ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={`mt-1 ${getFieldClasses(inputSize, error)} ${className}`}
      {...props}
    />
  )
);

Input.displayName = 'Input';

import { SelectHTMLAttributes, forwardRef } from 'react';
import { type InputSize, getFieldClasses, DISABLED_INPUT } from './styles';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  selectSize?: InputSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, selectSize = 'md', className = '', children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={error || undefined}
        className={`mt-1 ${getFieldClasses(selectSize, error)} ${props.disabled ? DISABLED_INPUT : ''} ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';

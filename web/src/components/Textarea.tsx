import { TextareaHTMLAttributes, forwardRef } from 'react';
import { type InputSize, getFieldClasses } from './styles';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  textareaSize?: InputSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, textareaSize = 'md', className = '', ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={error || undefined}
        className={`mt-1 ${getFieldClasses(textareaSize, error)} ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';

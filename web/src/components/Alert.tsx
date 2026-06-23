import { ReactNode } from 'react';

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

interface AlertProps {
  variant: AlertVariant;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-green-200 bg-green-50 text-green-700',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
};

export function Alert({ variant, children, onDismiss, className = '' }: AlertProps) {
  return (
    <div
      role="alert"
      className={`rounded-md border p-3 text-sm ${VARIANT_CLASSES[variant]} ${className}`}
    >
      <div className="flex items-center justify-between">
        <div>{children}</div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-3 text-current opacity-50 hover:opacity-80"
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

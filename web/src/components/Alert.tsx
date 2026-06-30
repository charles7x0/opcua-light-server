import { ReactNode } from 'react';
import { type AlertVariant, ALERT_BASE, ALERT_VARIANTS } from './styles';

interface AlertProps {
  variant: AlertVariant;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Alert({ variant, children, onDismiss, className = '' }: AlertProps) {
  return (
    <div role="alert" className={`${ALERT_BASE} ${ALERT_VARIANTS[variant]} ${className}`}>
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

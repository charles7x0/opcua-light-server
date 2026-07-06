import { ReactNode } from 'react';
import { type AlertVariant, ALERT_BASE, ALERT_VARIANTS } from '../styles';
import { Button } from '../actions/Button';

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
          <Button
            variant="ghost"
            size="xs"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="ml-3 text-current opacity-50 hover:opacity-80"
          >
            ✕
          </Button>
        )}
      </div>
    </div>
  );
}

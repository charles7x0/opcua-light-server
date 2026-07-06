import { ReactNode } from 'react';
import { type StatusDotColor, STATUS_DOT_BASE, STATUS_DOT_COLORS } from '../styles';

interface StatusDotProps {
  color: StatusDotColor;
  children: ReactNode;
  className?: string;
}

/**
 * A small colored indicator dot paired with a label.
 * Used in status bars and connection indicators.
 */
export function StatusDot({ color, children, className = '' }: StatusDotProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" className={`${STATUS_DOT_BASE} ${STATUS_DOT_COLORS[color]}`} />
      <span>{children}</span>
    </div>
  );
}

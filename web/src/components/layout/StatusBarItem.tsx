import { ReactNode } from 'react';
import { STATUS_BAR_ITEM_BASE } from '../styles';

interface StatusBarItemProps {
  icon?: string;
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A status bar segment with an optional icon and accessible label.
 * Wraps icon + text for consistent spacing and accessibility.
 */
export function StatusBarItem({ icon, label, children, className = '' }: StatusBarItemProps) {
  return (
    <span role="status" aria-label={label} className={`${STATUS_BAR_ITEM_BASE} ${className}`}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

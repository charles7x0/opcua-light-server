import { ReactNode } from 'react';
import { type BadgeVariant, BADGE_BASE, BADGE_VARIANTS, BADGE_DOT_VARIANTS } from '../styles';

interface BadgeProps {
  variant: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  /**
   * ARIA role for the badge. Defaults to "status" for live/dynamic badges
   * (e.g. connection state). Pass undefined for static, decorative labels
   * so screen readers do not treat them as live regions.
   */
  role?: string;
}

export function Badge({ variant, dot = false, children, className = '', 'aria-label': ariaLabel, role = 'status' }: BadgeProps) {
  return (
    <span className={`${BADGE_BASE} ${BADGE_VARIANTS[variant]} ${className}`} role={role} aria-label={ariaLabel}>
      {dot && (
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT_VARIANTS[variant]}`} />
      )}
      {children}
    </span>
  );
}

import { ReactNode } from 'react';
import { type BadgeVariant, BADGE_BASE, BADGE_VARIANTS, BADGE_DOT_VARIANTS } from './styles';

interface BadgeProps {
  variant: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant, dot = false, children, className = '' }: BadgeProps) {
  return (
    <span className={`${BADGE_BASE} ${BADGE_VARIANTS[variant]} ${className}`}>
      {dot && (
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT_VARIANTS[variant]}`} />
      )}
      {children}
    </span>
  );
}

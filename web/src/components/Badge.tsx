import { ReactNode } from 'react';

type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'gray';

interface BadgeProps {
  variant: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  blue: 'bg-blue-100 text-blue-800',
  gray: 'bg-gray-100 text-gray-800',
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  blue: 'bg-blue-500',
  gray: 'bg-gray-400',
};

export function Badge({ variant, dot = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_CLASSES[variant]} ${className}`}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[variant]}`}
        />
      )}
      {children}
    </span>
  );
}

import { ReactNode } from 'react';

interface InfoRowProps {
  /** Left-side label text */
  label: string;
  /** Right-side value — can be a string or any ReactNode (Badge, etc.) */
  children: ReactNode;
  /** Optional className override for the container */
  className?: string;
}

/**
 * A horizontal label-value row used in summary panels.
 * Renders a left-aligned label and right-aligned value.
 * Uses role="group" with aria-label so screen readers announce the pair together.
 */
export function InfoRow({ label, children, className = '' }: InfoRowProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center justify-between gap-2 ${className}`}
    >
      <span className="text-sm text-gray-600" aria-hidden="true">{label}</span>
      <span className="text-sm font-medium text-gray-900">{children}</span>
    </div>
  );
}

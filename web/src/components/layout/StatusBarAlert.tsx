import { ReactNode } from 'react';

interface StatusBarAlertProps {
  children: ReactNode;
  title?: string;
  className?: string;
}

/**
 * An inline alert indicator for the status bar.
 * Shows a warning icon with truncated text and a tooltip for the full message.
 */
export function StatusBarAlert({ children, title, className = '' }: StatusBarAlertProps) {
  return (
    <div role="alert" className={`text-red-400 truncate max-w-xs ${className}`} title={title}>
      <span aria-hidden="true">⚠</span> {children}
    </div>
  );
}

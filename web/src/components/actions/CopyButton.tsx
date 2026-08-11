import { useState } from 'react';

interface CopyButtonProps {
  /** The text value to copy to clipboard */
  value: string;
  /** Accessible label describing what is being copied */
  label?: string;
  /** Optional className for the button */
  className?: string;
}

/**
 * A small icon button that copies a value to the clipboard.
 * Shows a brief "copied" state via aria-label for screen readers.
 */
export function CopyButton({ value, label = 'Copy', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      /* silently fail if clipboard not available */
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        className={`text-gray-400 hover:text-gray-600 flex-shrink-0 ${className}`}
        aria-label={copied ? `${label} copied` : label}
        title="Copy to clipboard"
      >
        <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      </button>
      {copied && <span className="sr-only" role="status">Copied to clipboard</span>}
    </>
  );
}

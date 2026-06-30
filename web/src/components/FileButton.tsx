import { useRef } from 'react';
import { type ButtonSize, BUTTON_SIZES, FILE_BUTTON_BASE, DISABLED_STYLES } from './styles';

interface FileButtonProps {
  children: React.ReactNode;
  accept?: string;
  disabled?: boolean;
  size?: ButtonSize;
  onFileSelect: (file: File) => void;
  className?: string;
}

export function FileButton({
  children,
  accept,
  disabled = false,
  size = 'sm',
  onFileSelect,
  className = '',
}: FileButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    e.target.value = '';
  }

  return (
    <label
      className={`${FILE_BUTTON_BASE} ${BUTTON_SIZES[size]} ${disabled ? `${DISABLED_STYLES} pointer-events-none` : ''} ${className}`}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
    </label>
  );
}

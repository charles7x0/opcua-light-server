import { useRef } from 'react';
import { type ButtonSize, BUTTON_SIZES, DISABLED_STYLES } from './styles';

interface FileButtonProps {
  /** Text shown on the button */
  children: React.ReactNode;
  /** File input accept attribute */
  accept?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Size variant matching Button sizes */
  size?: ButtonSize;
  /** Called when a file is selected */
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
    if (file) {
      onFileSelect(file);
    }
    e.target.value = '';
  }

  return (
    <label
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer ${BUTTON_SIZES[size]} ${disabled ? `${DISABLED_STYLES} pointer-events-none` : ''} ${className}`}
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

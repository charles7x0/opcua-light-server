import { Button } from './Button';
import { DIALOG_OVERLAY, DIALOG_PANEL, DIALOG_TITLE, DIALOG_MESSAGE } from '../styles';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_TO_BUTTON = {
  danger: 'danger',
  warning: 'success',
} as const;

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
      <div className={DIALOG_OVERLAY} onClick={onCancel} />
      <div className={DIALOG_PANEL}>
        <h3 id="confirm-title" className={DIALOG_TITLE}>{title}</h3>
        <p id="confirm-desc" className={DIALOG_MESSAGE}>{message}</p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={VARIANT_TO_BUTTON[variant]} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { AlertTriangle, X } from 'lucide-react';

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  const btnClass =
    variant === 'danger'
      ? 'bg-gh-danger-em hover:bg-gh-danger focus:ring-red-500'
      : 'bg-gh-accent-em hover:bg-gh-accent focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70" onClick={onCancel} aria-hidden="true" />
      <div className="relative bg-gh-canvas-subtle border border-gh-border rounded-xl shadow-xl shadow-black/40 max-w-md w-full p-6">
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 text-gh-text-muted hover:text-gh-text-secondary"
        >
          <X size={18} />
        </button>

        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="mt-0.5 p-2 rounded-full bg-red-400/10">
              <AlertTriangle size={18} className="text-gh-danger" />
            </div>
          )}
          <div>
            <h3 className="text-base font-semibold text-gh-text">{title}</h3>
            <p className="mt-1.5 text-sm text-gh-text-secondary leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium border border-gh-border rounded-md text-gh-text hover:bg-gh-overlay focus:outline-none focus:ring-2 focus:ring-gh-border"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 ${btnClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

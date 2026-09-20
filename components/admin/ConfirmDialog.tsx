"use client";

import Modal from "./Modal";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Deletion",
  message = "Are you sure you want to delete this item? This action cannot be undone.",
  confirmText = "Delete",
  cancelText = "Cancel",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="440px">
      <div className="flex flex-col gap-6">
        <p className="m-0 text-sm leading-relaxed text-fg-secondary">
          {message}
        </p>

        <div className="flex gap-2.5 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg cursor-pointer bg-transparent border border-subtle text-fg-muted hover:border-zinc-600 hover:text-fg-primary font-semibold text-xs tracking-wider transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg cursor-pointer bg-danger-muted border border-danger text-danger font-bold text-xs tracking-wider transition-all hover:bg-danger-muted hover:border-danger disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Deleting..." : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

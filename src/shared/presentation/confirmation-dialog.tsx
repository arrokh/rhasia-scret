"use client";

import { useCallback } from "react";

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  danger = false,
  onCancel,
  onConfirm
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const openDialog = useCallback((dialog: HTMLDialogElement | null) => {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={openDialog}
      className="vault-dialog confirmation-dialog"
      aria-labelledby="confirmation-title"
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div className="confirmation-icon" aria-hidden="true">!</div>
      <h2 id="confirmation-title">{title}</h2>
      <p>{description}</p>
      <div className="form-actions confirmation-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={pending}>Batal</button>
        <button className={danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm} disabled={pending} aria-busy={pending}>
          {pending ? "Memproses…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

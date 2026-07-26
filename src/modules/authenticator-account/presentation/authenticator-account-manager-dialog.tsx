"use client";

import { useCallback, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration } from "../infrastructure/browser-account-payload";
import type { WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { useDeleteEncryptedAuthenticatorAccountMutation, useUpdateEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";

export function AuthenticatorAccountManagerDialog({
  account,
  vaultKey,
  onUpdated,
  onDeleted,
  onClose
}: {
  account: WorkspaceAuthenticatorAccount;
  vaultKey: Uint8Array;
  onUpdated: (account: WorkspaceAuthenticatorAccount) => void;
  onDeleted: (account: WorkspaceAuthenticatorAccount) => void;
  onClose: () => void;
}) {
  const online = useOnlineStatus();
  const [status, setStatus] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateMutation = useUpdateEncryptedAuthenticatorAccountMutation();
  const deleteMutation = useDeleteEncryptedAuthenticatorAccountMutation();
  const openDialog = useCallback((dialog: HTMLDialogElement | null) => {
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const form = useForm({
    defaultValues: { label: account.accountName },
    onSubmit: async ({ value }) => {
      if (!online) return;
      setStatus("");
      try {
        const nextAccount = { ...account, accountName: value.label.trim() };
        const encryptedPayload = await encryptAccountConfiguration(vaultKey, nextAccount);
        const updated = await updateMutation.mutateAsync({
          vaultId: account.vaultId,
          vaultType: account.vaultType,
          accountId: account.id,
          expectedRevision: account.revision,
          encryptedPayload: bytesToBase64(encryptedPayload),
          encryptionVersion: 1
        });
        onUpdated({ ...nextAccount, revision: updated.revision });
        setStatus("Label akun diperbarui.");
      } catch {
        setStatus("Label tidak dapat diperbarui. Muat ulang jika akun telah berubah di perangkat lain.");
      }
    }
  });

  async function deleteAccount() {
    try {
      await deleteMutation.mutateAsync({
        vaultId: account.vaultId,
        vaultType: account.vaultType,
        accountId: account.id,
        expectedRevision: account.revision
      });
      onDeleted(account);
      onClose();
    } catch {
      setConfirmingDelete(false);
      setStatus("Akun tidak dapat dihapus. Muat ulang jika akun telah berubah di perangkat lain.");
    }
  }

  return (
    <dialog
      ref={openDialog}
      className="vault-dialog account-manager-dialog"
      aria-labelledby="account-manager-title"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget && !updateMutation.isPending && !deleteMutation.isPending) event.currentTarget.close();
      }}
    >
      <div className="dialog-heading">
        <div><p className="eyebrow">KELOLA AKUN</p><h2 id="account-manager-title">{account.accountName}</h2></div>
        <button className="icon-button" type="button" aria-label="Tutup pengaturan akun" onClick={() => onClose()}><CloseIcon /></button>
      </div>
      <p className="vault-flow-copy">{account.issuer} · {account.vaultName}</p>
      <form noValidate className="auth-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
        <form.Field name="label" validators={{ onSubmit: requiredText("Label akun") }}>
          {(field) => <div className="account-field"><label htmlFor={`managed-account-label-${account.id}`}>Label akun</label><input id={`managed-account-label-${account.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `managed-account-label-${account.id}-error` : undefined} required disabled={!online || updateMutation.isPending} /><FormFieldError id={`managed-account-label-${account.id}-error`} errors={field.state.meta.errors} /></div>}
        </form.Field>
        <div className="account-manager-actions">
          <button className="danger-button" type="button" onClick={() => setConfirmingDelete(true)} disabled={!online || deleteMutation.isPending}>Hapus akun</button>
          <button className="primary-button" type="submit" disabled={!online || updateMutation.isPending} aria-busy={updateMutation.isPending}>{updateMutation.isPending ? "Menyimpan…" : "Simpan label"}</button>
        </div>
      </form>
      {!online && <p className="offline-notice" role="status">Luring: akun tidak dapat diubah.</p>}
      {status && <p className="form-status" role="status">{status}</p>}
      {confirmingDelete && (
        <ConfirmationDialog
          title="Hapus akun autentikator?"
          description={`${account.accountName} (${account.issuer}) akan dihapus dari ${account.vaultName} dan dapat dipulihkan selama masa pemulihan.`}
          confirmLabel="Hapus akun"
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void deleteAccount()}
        />
      )}
    </dialog>
  );
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

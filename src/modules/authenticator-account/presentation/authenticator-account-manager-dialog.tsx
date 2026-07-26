"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration } from "../infrastructure/browser-account-payload";
import type { WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { useDeleteEncryptedAuthenticatorAccountMutation, useUpdateEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";

export function AuthenticatorAccountManagerDialog({ account, vaultKey, onUpdated, onDeleted, onClose }: { account: WorkspaceAuthenticatorAccount; vaultKey: Uint8Array; onUpdated: (account: WorkspaceAuthenticatorAccount) => void; onDeleted: (account: WorkspaceAuthenticatorAccount) => void; onClose: () => void }) {
  const online = useOnlineStatus();
  const [status, setStatus] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateMutation = useUpdateEncryptedAuthenticatorAccountMutation();
  const deleteMutation = useDeleteEncryptedAuthenticatorAccountMutation();
  const form = useForm({
    defaultValues: { label: account.accountName },
    onSubmit: async ({ value }) => {
      if (!online) return;
      setStatus("");
      try {
        const nextAccount = { ...account, accountName: value.label.trim() };
        const encryptedPayload = await encryptAccountConfiguration(vaultKey, nextAccount);
        const updated = await updateMutation.mutateAsync({ vaultId: account.vaultId, vaultType: account.vaultType, accountId: account.id, expectedRevision: account.revision, encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 });
        onUpdated({ ...nextAccount, revision: updated.revision });
        setStatus("Label akun diperbarui.");
      } catch { setStatus("Label tidak dapat diperbarui. Muat ulang jika akun telah berubah di perangkat lain."); }
    }
  });

  async function deleteAccount() {
    try { await deleteMutation.mutateAsync({ vaultId: account.vaultId, vaultType: account.vaultType, accountId: account.id, expectedRevision: account.revision }); onDeleted(account); onClose(); }
    catch { setConfirmingDelete(false); setStatus("Akun tidak dapat dihapus. Muat ulang jika akun telah berubah di perangkat lain."); }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !updateMutation.isPending && !deleteMutation.isPending) onClose(); }}>
        <DialogContent className="max-w-md rounded-lg bg-card p-5" showCloseButton={!updateMutation.isPending && !deleteMutation.isPending}>
          <DialogHeader><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Kelola akun</p><DialogTitle className="text-xl font-bold text-ink-strong">{account.accountName}</DialogTitle><DialogDescription>{account.issuer} · {account.vaultName}</DialogDescription></DialogHeader>
          <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
            <form.Field name="label" validators={{ onSubmit: requiredText("Label akun") }}>
              {(field) => <div className="grid gap-2"><Label htmlFor={`managed-account-label-${account.id}`}>Label akun</Label><Input id={`managed-account-label-${account.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `managed-account-label-${account.id}-error` : undefined} required disabled={!online || updateMutation.isPending} /><FormFieldError id={`managed-account-label-${account.id}-error`} errors={field.state.meta.errors} /></div>}
            </form.Field>
            {!online && <StatusBanner tone="offline">Anda luring. Akun tidak dapat diubah.</StatusBanner>}
            {status && <StatusBanner tone={status.includes("diperbarui") ? "success" : "danger"} role={status.includes("diperbarui") ? "status" : "alert"}>{status}</StatusBanner>}
            <DialogFooter className="-mx-5 -mb-5 grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
              <Button variant="destructive" type="button" onClick={() => setConfirmingDelete(true)} disabled={!online || deleteMutation.isPending}><Trash2 />Hapus akun</Button>
              <Button type="submit" disabled={!online || updateMutation.isPending} aria-busy={updateMutation.isPending}>{updateMutation.isPending ? "Menyimpan…" : "Simpan label"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirmingDelete && <ConfirmationDialog title="Hapus akun autentikator?" description={`${account.accountName} (${account.issuer}) akan dihapus dari ${account.vaultName} dan dapat dipulihkan selama masa pemulihan.`} confirmLabel="Hapus akun" danger pending={deleteMutation.isPending} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void deleteAccount()} />}
    </>
  );
}

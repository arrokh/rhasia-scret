"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration } from "../infrastructure/browser-account-payload";
import type { WorkspaceAuthenticatorAccount } from "../infrastructure/browser-vault-workspace";
import { useDeleteEncryptedAuthenticatorAccountMutation, useUpdateEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";

export function AuthenticatorAccountManagerDialog({ account, vaultKey, canEdit = true, canDelete = true, onUpdated, onDeleted, onPermissionChanged, onClose }: { account: WorkspaceAuthenticatorAccount; vaultKey: Uint8Array; canEdit?: boolean; canDelete?: boolean; onUpdated: (account: WorkspaceAuthenticatorAccount) => void; onDeleted: (account: WorkspaceAuthenticatorAccount) => void; onPermissionChanged?: () => Promise<void>; onClose: () => void }) {
  const t = useTranslations("AuthenticatorAccount.manager");
  const online = useOnlineStatus();
  const [status, setStatus] = useState<"updated" | "updateError" | "deleteError" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateMutation = useUpdateEncryptedAuthenticatorAccountMutation();
  const deleteMutation = useDeleteEncryptedAuthenticatorAccountMutation();
  const form = useForm({
    defaultValues: { label: account.accountName },
    onSubmit: async ({ value }) => {
      if (!online || !canEdit) return;
      setStatus(null);
      try {
        const nextAccount = { ...account, accountName: value.label.trim() };
        const encryptedPayload = await encryptAccountConfiguration(vaultKey, nextAccount, { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: account.vaultId, keyVersion: 1 });
        const updated = await updateMutation.mutateAsync({ vaultId: account.vaultId, vaultType: account.vaultType, accountId: account.id, expectedRevision: account.revision, encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 });
        onUpdated({ ...nextAccount, revision: updated.revision });
        setStatus("updated");
      } catch (error) { if (isPermissionChange(error)) await onPermissionChanged?.(); setStatus("updateError"); }
    }
  });

  async function deleteAccount() {
    try { await deleteMutation.mutateAsync({ vaultId: account.vaultId, vaultType: account.vaultType, accountId: account.id, expectedRevision: account.revision }); onDeleted(account); onClose(); }
    catch (error) { if (isPermissionChange(error)) await onPermissionChanged?.(); setConfirmingDelete(false); setStatus("deleteError"); }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !updateMutation.isPending && !deleteMutation.isPending) onClose(); }}>
        <DialogContent className="max-w-md rounded-lg bg-card p-5" showCloseButton={!updateMutation.isPending && !deleteMutation.isPending}>
          <DialogHeader><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("manage")}</p><DialogTitle className="text-xl font-bold text-ink-strong">{account.accountName}</DialogTitle><DialogDescription>{account.issuer} · {account.vaultName}</DialogDescription></DialogHeader>
          <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
            <form.Field name="label" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("required") }}>
              {(field) => <div className="grid gap-2"><Label htmlFor={`managed-account-label-${account.id}`}>{t("accountLabel")}</Label><Input id={`managed-account-label-${account.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `managed-account-label-${account.id}-error` : undefined} required disabled={!online || !canEdit || updateMutation.isPending} /><FormFieldError id={`managed-account-label-${account.id}-error`} errors={field.state.meta.errors} /></div>}
            </form.Field>
            {!online && <StatusBanner tone="offline">{t("offline")}</StatusBanner>}
            {status && <StatusBanner tone={status === "updated" ? "success" : "danger"} role={status === "updated" ? "status" : "alert"}>{t(status)}</StatusBanner>}
            <DialogFooter className="-mx-5 -mb-5 grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
              {canDelete && <Button variant="destructive" type="button" onClick={() => setConfirmingDelete(true)} disabled={!online || deleteMutation.isPending}><Trash2 />{t("delete")}</Button>}
              {canEdit && <Button type="submit" disabled={!online || updateMutation.isPending} aria-busy={updateMutation.isPending}>{updateMutation.isPending ? t("saving") : t("save")}</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {canDelete && confirmingDelete && <ConfirmationDialog title={t("confirmTitle")} description={t("confirmDescription", { account: account.accountName, issuer: account.issuer, vault: account.vaultName })} confirmLabel={t("delete")} danger pending={deleteMutation.isPending} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void deleteAccount()} />}
    </>
  );
}

function isPermissionChange(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 403 && error.code === "account_permission_required";
}

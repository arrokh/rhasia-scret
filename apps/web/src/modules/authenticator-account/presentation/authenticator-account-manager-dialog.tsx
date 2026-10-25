"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration } from "../infrastructure/browser-account-payload";
import { AccountTagsEditor } from "./account-tags-editor";
import { AccountTagValidationError, normalizeAuthenticatorAccountTags } from "@rhasia-scret/client-vault-core";
import { trackVaultSensitiveOperation, type WorkspaceAuthenticatorAccount } from "@/modules/sync";
import {
  useDeleteEncryptedAuthenticatorAccountMutation,
  useUpdateEncryptedAuthenticatorAccountMutation,
} from "./hooks/use-authenticator-account-mutations";

export function AuthenticatorAccountManagerDialog({
  account,
  vaultKey,
  keyVersion,
  canEdit = true,
  canDelete = true,
  onUpdated,
  onDeleted,
  onPermissionChanged,
  onClose,
}: {
  account: WorkspaceAuthenticatorAccount;
  vaultKey: Uint8Array;
  keyVersion?: number;
  canEdit?: boolean;
  canDelete?: boolean;
  onUpdated: (account: WorkspaceAuthenticatorAccount) => void;
  onDeleted: (account: WorkspaceAuthenticatorAccount) => void;
  onPermissionChanged?: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("AuthenticatorAccount.manager");
  const tCommon = useTranslations("Common");
  const online = useOnlineStatus();
  const [status, setStatus] = useState<"updated" | "updateError" | "deleteError" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateMutation = useUpdateEncryptedAuthenticatorAccountMutation();
  const deleteMutation = useDeleteEncryptedAuthenticatorAccountMutation();
  const form = useForm({
    defaultValues: { label: account.accountName, tags: account.tags ?? [], tagDraft: "" },
    onSubmit: async ({ value }) => {
      if (!online || !canEdit) return;
      setStatus(null);
      try {
        const nextAccount = { ...account, accountName: value.label.trim(), tags: value.tags };
        const encryptedPayload = await trackVaultSensitiveOperation(() =>
          encryptAccountConfiguration(vaultKey, nextAccount, {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            vaultId: account.vaultId,
            keyVersion: 1,
          }),
        );
        const updated = await updateMutation.mutateAsync({
          vaultId: account.vaultId,
          vaultType: account.vaultType,
          keyVersion,
          accountId: account.id,
          expectedRevision: account.revision,
          encryptedPayload: bytesToBase64(encryptedPayload),
          encryptionVersion: 1,
        });
        onUpdated({ ...nextAccount, revision: updated.revision });
        captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountUpdated, { vault_type: account.vaultType });
        setStatus("updated");
      } catch (error) {
        const permissionDenied = isPermissionChange(error);
        const staleKeyVersion = isStaleKeyVersion(error);
        captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountOperationFailed, {
          operation: "update",
          failure_code: permissionDenied ? "permission_denied" : "unknown",
        });
        if (permissionDenied || staleKeyVersion) await onPermissionChanged?.();
        setStatus("updateError");
      }
    },
  });

  async function deleteAccount() {
    try {
      await deleteMutation.mutateAsync({
        vaultId: account.vaultId,
        vaultType: account.vaultType,
        accountId: account.id,
        expectedRevision: account.revision,
      });
      onDeleted(account);
      captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountDeleted, { vault_type: account.vaultType });
      onClose();
    } catch (error) {
      const permissionDenied = isPermissionChange(error);
      captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountOperationFailed, {
        operation: "delete",
        failure_code: permissionDenied ? "permission_denied" : "unknown",
      });
      if (permissionDenied) await onPermissionChanged?.();
      setConfirmingDelete(false);
      setStatus("deleteError");
    }
  }

  function validateTags(tags: string[]): string | undefined {
    try {
      normalizeAuthenticatorAccountTags(tags);
      return undefined;
    } catch (error) {
      if (error instanceof AccountTagValidationError) return t(`tagErrors.${error.code}`);
      return t("tagErrors.notArray");
    }
  }

  function validateTagDraft(draft: string, tags: string[]): string | undefined {
    if (!draft.trim()) return undefined;
    return validateTags([...tags, draft.trim()]);
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !updateMutation.isPending && !deleteMutation.isPending) onClose();
        }}
      >
        <DialogContent
          className="max-w-md rounded-lg bg-card p-5"
          showCloseButton={!updateMutation.isPending && !deleteMutation.isPending}
          closeLabel={tCommon("close")}
        >
          <DialogHeader className="min-w-0">
            <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("manage")}</p>
            <DialogTitle
              className="min-w-0 w-full max-w-full truncate pr-10 text-xl font-bold text-ink-strong"
              title={account.accountName}
            >
              {account.accountName}
            </DialogTitle>
            <DialogDescription>
              {account.issuer} · {account.vaultName}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="label"
              validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("required")) }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={`managed-account-label-${account.id}`}>{t("accountLabel")}</Label>
                  <Input
                    id={`managed-account-label-${account.id}`}
                    value={field.state.value}
                    onChange={(event) => {
                      setStatus(null);
                      field.handleChange(event.target.value);
                    }}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length ? `managed-account-label-${account.id}-error` : undefined
                    }
                    required
                    disabled={!online || !canEdit || updateMutation.isPending}
                  />
                  <FormFieldError id={`managed-account-label-${account.id}-error`} errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field
              name="tags"
              validators={{
                onChange: ({ value }) => validateTags(value),
                onSubmit: ({ value }) => validateTags(value),
              }}
            >
              {(tagsField) => (
                <form.Field
                  name="tagDraft"
                  validators={{
                    onChange: ({ value }) => validateTagDraft(value, form.getFieldValue("tags")),
                    onSubmit: ({ value }) => (value.trim() ? t("tagDraftNotAdded") : undefined),
                  }}
                >
                  {(draftField) => (
                    <AccountTagsEditor
                      tags={tagsField.state.value}
                      draft={draftField.state.value}
                      errors={draftField.state.meta.errors}
                      inputId={`managed-account-tag-${account.id}`}
                      errorId={`managed-account-tag-${account.id}-error`}
                      disabled={!online || !canEdit}
                      busy={updateMutation.isPending}
                      onDraftChange={(value) => {
                        setStatus(null);
                        draftField.handleChange(value);
                      }}
                      onAdd={() => {
                        const tag = draftField.state.value.trim();
                        if (!tag || draftField.state.meta.errors.length > 0) return;
                        setStatus(null);
                        tagsField.handleChange([...tagsField.state.value, tag]);
                        draftField.handleChange("");
                      }}
                      onRemove={(index) => {
                        setStatus(null);
                        tagsField.handleChange(tagsField.state.value.filter((_, tagIndex) => tagIndex !== index));
                      }}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
            {!online && <StatusBanner tone="offline">{t("offline")}</StatusBanner>}
            {status && status !== "updated" && (
              <StatusBanner tone="danger" role="alert">
                {t(status)}
              </StatusBanner>
            )}
            <DialogFooter className="-mx-5 -mb-5 grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
              {canDelete && (
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={!online || deleteMutation.isPending}
                >
                  <Trash2 />
                  {t("delete")}
                </Button>
              )}
              {canEdit && (
                <Button
                  type="submit"
                  className={
                    status === "updated"
                      ? "border-success/30 bg-success/10 text-success hover:bg-success/10 disabled:bg-success/10 disabled:text-success"
                      : undefined
                  }
                  disabled={!online || updateMutation.isPending || status === "updated"}
                  aria-busy={updateMutation.isPending}
                  aria-live={status === "updated" ? "polite" : undefined}
                >
                  {status === "updated" && <CheckCircle2 className="size-5" aria-hidden="true" />}
                  {status === "updated" ? t("updated") : updateMutation.isPending ? t("saving") : t("save")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {canDelete && confirmingDelete && (
        <ConfirmationDialog
          title={t("confirmTitle")}
          description={t("confirmDescription", {
            account: account.accountName,
            issuer: account.issuer,
            vault: account.vaultName,
          })}
          confirmLabel={t("delete")}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void deleteAccount()}
        />
      )}
    </>
  );
}

function isPermissionChange(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 403 && error.code === "account_permission_required";
}

function isStaleKeyVersion(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 409 && error.code === "stale_key_version";
}

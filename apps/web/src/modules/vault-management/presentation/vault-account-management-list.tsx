"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Plus, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";

export type ManagedVaultAccountSummary = {
  id: string;
  issuer: string;
  accountName: string;
  revision: number;
  unavailable?: boolean;
};

export function VaultAccountManagementList({
  vaultId,
  vaultName,
  vaultType,
  accounts,
  canAddAccounts = true,
  canDeleteAccounts = true,
  onAudit,
  onAccountDeleted,
}: {
  vaultId: string;
  vaultName: string;
  vaultType: "PERSONAL" | "SHARED";
  accounts: ManagedVaultAccountSummary[];
  canAddAccounts?: boolean;
  canDeleteAccounts?: boolean;
  onAudit?: (account: ManagedVaultAccountSummary) => void;
  onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void>;
}) {
  const t = useTranslations("VaultManagement.accounts");
  const [accountToDelete, setAccountToDelete] = useState<ManagedVaultAccountSummary | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [status, setStatus] = useState<"deleted" | "deleteError" | null>(null);

  async function removeAccount(account: ManagedVaultAccountSummary) {
    setStatus(null);
    setDeletingAccount(true);
    try {
      await onAccountDeleted(vaultId, account.id, account.revision);
      captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountDeleted, { vault_type: vaultType });
      setAccountToDelete(null);
      setStatus("deleted");
    } catch {
      captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountOperationFailed, {
        operation: "delete",
        failure_code: "unknown",
      });
      setStatus("deleteError");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("eyebrow")}</p>
          <h3 className="mt-1 font-bold text-ink-strong">{t("title")}</h3>
        </div>
        {canAddAccounts && (
          <Button size="sm" asChild>
            <Link href={`/vaults/accounts/new?vaultId=${encodeURIComponent(vaultId)}`}>
              <Plus />
              {t("add")}
            </Link>
          </Button>
        )}
      </div>
      {accounts.length ? (
        <ul className="grid list-none gap-2 p-0">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md border bg-card p-2.5"
            >
              <span
                className="grid size-10 place-items-center rounded-md bg-muted font-bold text-foreground"
                aria-hidden="true"
              >
                {account.unavailable ? "!" : account.issuer.slice(0, 1).toUpperCase()}
              </span>
              <span className="grid min-w-0">
                <strong className="truncate text-sm">
                  {account.unavailable ? t("unavailableTitle") : account.issuer}
                </strong>
                <span className="truncate text-xs text-muted-foreground">
                  {account.unavailable ? t("unavailableId", { id: account.id }) : account.accountName}
                </span>
              </span>
              {(onAudit || canDeleteAccounts) && (
                <span className="flex items-center">
                  {onAudit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      aria-label={
                        account.unavailable
                          ? t("viewUnavailableAudit", { id: account.id })
                          : t("viewAudit", { issuer: account.issuer, account: account.accountName })
                      }
                      onClick={() => onAudit(account)}
                    >
                      <ScrollText />
                    </Button>
                  )}
                  {canDeleteAccounts && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:bg-danger-surface hover:text-destructive"
                      type="button"
                      aria-label={
                        account.unavailable
                          ? t("deleteUnavailableLabel", { id: account.id })
                          : t("deleteLabel", { issuer: account.issuer, account: account.accountName })
                      }
                      onClick={() => setAccountToDelete(account)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center">
          <KeyRound className="size-6 text-taupe" />
          <p className="font-bold">{t("empty")}</p>
          <p className="text-sm text-muted-foreground">
            {canAddAccounts ? t("emptyEditable", { vault: vaultName }) : t("emptyReadOnly")}
          </p>
        </div>
      )}
      {status && <StatusBanner tone={status === "deleted" ? "success" : "danger"}>{t(status)}</StatusBanner>}
      {accountToDelete && (
        <ConfirmationDialog
          title={t("confirmTitle")}
          description={
            accountToDelete.unavailable
              ? t("confirmUnavailableDescription", { id: accountToDelete.id, vault: vaultName })
              : t("confirmDescription", {
                  issuer: accountToDelete.issuer,
                  account: accountToDelete.accountName,
                  vault: vaultName,
                })
          }
          confirmLabel={t("confirm")}
          danger
          pending={deletingAccount}
          onCancel={() => setAccountToDelete(null)}
          onConfirm={() => void removeAccount(accountToDelete)}
        />
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, DatabaseBackup, Import, KeyRound, Plus, Trash2, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useVaultAuditQuery,
  VaultAuditHistory,
  type SelectedAuditFilter,
  type VaultAuditFilter,
} from "@/modules/audit";
import {
  VaultMemberPermissionNotice,
  VaultMembershipDefaults,
  VaultMembershipOwnerPanel,
  type EffectiveSharedVaultAccountPermissions,
  type SharedVaultAccountPermissions,
} from "@/modules/vault-membership";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { encryptSharedVaultName } from "../infrastructure/browser-shared-vault-creator";
import { useDeleteSharedVaultMutation, useRenameSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { VaultAccountManagementList, type ManagedVaultAccountSummary } from "./vault-account-management-list";

type SharedVaultAccountSummary = ManagedVaultAccountSummary;
export type SharedVaultSummary = {
  id: string;
  name: string;
  role: "OWNER" | "VIEWER";
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  key: Uint8Array;
  accounts: SharedVaultAccountSummary[];
};

export function SharedVaultDirectory({ vaults }: { vaults: SharedVaultSummary[] }) {
  const t = useTranslations("VaultManagement.directory");
  return (
    <div className="grid gap-5 p-5 sm:p-6">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink-strong">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <nav
          aria-label={t("archiveActions")}
          className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:shrink-0"
        >
          <Button variant="outline" size="icon" asChild>
            <Link href="/vaults/backup" aria-label={t("backup")} title={t("backup")}>
              <DatabaseBackup aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link href="/vaults/import" aria-label={t("importArchive")} title={t("importArchive")}>
              <Import aria-hidden="true" />
            </Link>
          </Button>
          <Button className="min-w-0" asChild>
            <Link href="/vaults/manage/new">
              <Plus />
              {t("shared")}
            </Link>
          </Button>
        </nav>
      </div>
      <ul className="grid list-none gap-2 p-0">
        <li>
          <VaultDirectoryLink
            href="/vaults/manage/personal"
            icon={KeyRound}
            name={t("personalVault")}
            detail={t("personalOwner")}
            badge={t("personal")}
          />
        </li>
        {vaults.map((vault) => {
          const memberCanChangeAccounts = Object.values(vault.effectiveAccountPermissions.permissions).some(Boolean);
          const role =
            vault.role === "OWNER" ? t("owner") : memberCanChangeAccounts ? t("memberWithPermissions") : t("canView");
          return (
            <li key={vault.id}>
              <VaultDirectoryLink
                href={`/vaults/manage/${encodeURIComponent(vault.id)}`}
                icon={UsersRound}
                name={vault.name}
                detail={t("detail", { count: vault.accounts.length, role })}
                badge={vault.role === "OWNER" ? t("owner") : t("viewer")}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VaultDirectoryLink({
  href,
  icon: Icon,
  name,
  detail,
  badge,
}: {
  href: string;
  icon: typeof KeyRound;
  name: string;
  detail: string;
  badge: string;
}) {
  return (
    <Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 p-3 text-left" asChild>
      <Link href={href}>
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground">
          <Icon />
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <strong className="truncate text-sm text-foreground">{name}</strong>
          <span className="text-xs font-normal text-muted-foreground">{detail}</span>
        </span>
        <Badge className="bg-muted text-muted-foreground">{badge}</Badge>
        <ChevronRight className="text-muted-foreground" />
      </Link>
    </Button>
  );
}

export function SharedVaultDetails({
  vault,
  ownerEmail,
  initialDefaultAccountPermissions,
  onRenamed,
  onAccountDeleted,
  onDeleted,
}: {
  vault: SharedVaultSummary;
  ownerEmail: string;
  initialDefaultAccountPermissions?: { permissions: SharedVaultAccountPermissions; revision: number };
  onRenamed: (vaultId: string, name: string) => void;
  onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void>;
  onDeleted?: (vaultId: string) => void;
}) {
  const t = useTranslations("VaultManagement.details");
  const [activeTab, setActiveTab] = useState("details");
  const [status, setStatus] = useState<"renamed" | "renameError" | "deleteError" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [auditFilter, setAuditFilter] = useState<SelectedAuditFilter>({ query: {}, label: "" });
  const renameMutation = useRenameSharedVaultMutation();
  const deleteMutation = useDeleteSharedVaultMutation();
  const audit = useVaultAuditQuery(vault.id, auditFilter.query, vault.role === "OWNER" && activeTab === "audit");
  const renameForm = useForm({
    defaultValues: { name: vault.name },
    onSubmit: async ({ value }) => {
      try {
        const name = value.name.trim();
        const encryptedName = await encryptSharedVaultName(vault.key, name);
        await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) });
        onRenamed(vault.id, name);
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultRenamed);
        setStatus("renamed");
      } catch {
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, {
          operation: "rename",
          failure_code: "unknown",
        });
        setStatus("renameError");
      }
    },
  });

  function openAudit(filter: VaultAuditFilter, label: string) {
    setAuditFilter({ query: filter, label });
    setActiveTab("audit");
  }
  async function deleteVault() {
    setStatus(null);
    try {
      await deleteMutation.mutateAsync(vault.id);
      setConfirmingDelete(false);
      captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultDeleted);
      onDeleted?.(vault.id);
    } catch {
      captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, {
        operation: "delete",
        failure_code: "unknown",
      });
      setConfirmingDelete(false);
      setStatus("deleteError");
    }
  }

  return (
    <div className="p-5 sm:p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {vault.role === "OWNER" && (
          <TabsList className="grid-cols-3">
            <TabsTrigger value="details">{t("detailTab")}</TabsTrigger>
            <TabsTrigger value="invitations">{t("invitationsTab")}</TabsTrigger>
            <TabsTrigger value="audit">{t("auditTab")}</TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="details" className={`grid gap-5 ${vault.role === "OWNER" ? "" : "mt-0"}`}>
          {vault.role === "OWNER" ? (
            <>
              <div className="grid gap-1">
                <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("owner")}</p>
                <p className="text-sm font-bold text-foreground">{ownerEmail}</p>
              </div>
              <form
                noValidate
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void renameForm.handleSubmit();
                }}
              >
                <renameForm.Field
                  name="name"
                  validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("nameRequired")) }}
                >
                  {(field) => (
                    <>
                      <Label htmlFor={`shared-vault-name-${vault.id}`}>{t("sharedName")}</Label>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <Input
                          id={`shared-vault-name-${vault.id}`}
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          aria-invalid={field.state.meta.errors.length > 0}
                          aria-describedby={
                            field.state.meta.errors.length ? `shared-vault-name-${vault.id}-error` : undefined
                          }
                          required
                        />
                        <Button variant="outline" type="submit" disabled={renameMutation.isPending}>
                          {renameMutation.isPending ? t("saving") : t("save")}
                        </Button>
                      </div>
                      <FormFieldError id={`shared-vault-name-${vault.id}-error`} errors={field.state.meta.errors} />
                    </>
                  )}
                </renameForm.Field>
              </form>
              <VaultMembershipDefaults vaultId={vault.id} initial={initialDefaultAccountPermissions} />
              <DeleteSharedVaultSection vaultId={vault.id} onDelete={() => setConfirmingDelete(true)} />
            </>
          ) : (
            <VaultMemberPermissionNotice effective={vault.effectiveAccountPermissions} />
          )}
          {vault.accounts.some((account) => account.unavailable) && (
            <StatusBanner tone="warning" role="status">
              {t("unavailableAccountWarning")}
            </StatusBanner>
          )}
          <VaultAccountManagementList
            vaultId={vault.id}
            vaultName={vault.name}
            vaultType="SHARED"
            accounts={vault.accounts}
            canAddAccounts={vault.effectiveAccountPermissions.permissions.canAddAccounts}
            canDeleteAccounts={vault.effectiveAccountPermissions.permissions.canDeleteAccounts}
            onAudit={
              vault.role === "OWNER"
                ? (account) =>
                    openAudit(
                      { accountId: account.id },
                      account.unavailable ? account.id : `${account.issuer} · ${account.accountName}`,
                    )
                : undefined
            }
            onAccountDeleted={onAccountDeleted}
          />
          {status && (
            <StatusBanner
              tone={status === "renamed" ? "success" : "danger"}
              role={status === "renamed" ? "status" : "alert"}
            >
              {t(status)}
            </StatusBanner>
          )}
        </TabsContent>
        {vault.role === "OWNER" && (
          <TabsContent value="invitations">
            <VaultMembershipOwnerPanel
              vault={vault}
              active={activeTab === "invitations"}
              onAudit={(participant) =>
                participant.userId && openAudit({ actorUserId: participant.userId }, participant.email)
              }
            />
          </TabsContent>
        )}
        {vault.role === "OWNER" && (
          <TabsContent value="audit">
            <VaultAuditHistory
              audit={audit}
              accounts={vault.accounts}
              filter={auditFilter}
              onClearFilter={() => setAuditFilter({ query: {}, label: "" })}
            />
          </TabsContent>
        )}
      </Tabs>
      {confirmingDelete && (
        <ConfirmationDialog
          title={t("deleteConfirmTitle")}
          description={t("deleteConfirmDescription")}
          confirmLabel={t("deleteConfirmAction")}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void deleteVault()}
        />
      )}
    </div>
  );
}

function DeleteSharedVaultSection({ vaultId, onDelete }: { vaultId: string; onDelete: () => void }) {
  const t = useTranslations("VaultManagement.details");
  const [expanded, setExpanded] = useState(false);
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="rounded-md border border-destructive/20 bg-danger-surface/50"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto min-h-11 w-full justify-between gap-3 rounded-b-none p-4 text-left text-destructive whitespace-normal hover:bg-danger-surface hover:text-destructive"
          type="button"
          aria-controls={`delete-shared-vault-${vaultId}`}
        >
          <span className="font-bold">{t("deleteSectionTitle")}</span>
          <ChevronDown
            className={`size-5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent id={`delete-shared-vault-${vaultId}`}>
        <div className="grid gap-3 border-t border-destructive/20 p-4">
          <p className="text-sm text-muted-foreground">{t("deleteSectionDescription")}</p>
          <Button variant="destructive" className="justify-self-end" type="button" onClick={onDelete}>
            <Trash2 />
            {t("deleteVault")}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

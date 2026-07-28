"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ALL_ACCOUNT_PERMISSIONS, SecureShareLinkRedemption } from "@/modules/vault-membership";
import { PersonalVaultDetails, SharedVaultCreator, SharedVaultDetails, SharedVaultDirectory, type PersonalVaultSummary, type SharedVaultSummary } from "@/modules/vault-management";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useDeleteEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { VaultWorkspaceUnlock } from "./vault-workspace-unlock";

export function VaultDirectoryWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  return <SharedVaultDirectory vaults={sharedVaultSummaries(workspace)} />;
}

export function PersonalVaultDetailWorkspace({ personalVaultId, ownerEmail }: { personalVaultId: string; ownerEmail: string }) {
  const t = useTranslations("AuthenticatorAccount.workspace");
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const deleteAccount = useDeleteEncryptedAuthenticatorAccountMutation();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  const personalVault = personalVaultSummary(workspace, personalVaultId);
  if (!personalVault) return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="danger" role="alert">{t("personalUnavailable")}</StatusBanner><Button variant="outline" asChild><Link href="/vaults/manage">{t("allVaults")}</Link></Button></div>;
  return <PersonalVaultDetails vault={personalVault} ownerEmail={ownerEmail} onAccountDeleted={async (vaultId, accountId, expectedRevision) => { await deleteAccount.mutateAsync({ vaultId, vaultType: "PERSONAL", accountId, expectedRevision }); setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== accountId || account.vaultId !== vaultId), unavailableAccounts: current.unavailableAccounts.filter((account) => account.id !== accountId || account.vaultId !== vaultId) } : current); }} />;
}

export function SharedVaultDetailWorkspace({ personalVaultId, vaultId, ownerEmail }: { personalVaultId: string; vaultId: string; ownerEmail: string }) {
  const t = useTranslations("AuthenticatorAccount.workspace");
  const { workspace, setWorkspace, refreshWorkspaceAuthorization } = useUnlockedVaultWorkspace();
  const deleteAccount = useDeleteEncryptedAuthenticatorAccountMutation();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  const vault = sharedVaultSummaries(workspace).find((entry) => entry.id === vaultId);
  if (!vault) return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="danger" role="alert">{t("sharedUnavailable")}</StatusBanner><Button variant="outline" asChild><Link href="/vaults/manage">{t("allVaults")}</Link></Button></div>;
  return <SharedVaultDetails vault={vault} ownerEmail={ownerEmail} onRenamed={(updatedVaultId, name) => setWorkspace((current) => current ? { ...current, vaults: current.vaults.map((entry) => entry.id === updatedVaultId ? { ...entry, name } : entry), accounts: current.accounts.map((account) => account.vaultId === updatedVaultId ? { ...account, vaultName: name } : account) } : current)} onAccountDeleted={async (updatedVaultId, accountId, expectedRevision) => { try { await deleteAccount.mutateAsync({ vaultId: updatedVaultId, vaultType: "SHARED", accountId, expectedRevision }); } catch (error) { if (isPermissionChange(error)) await refreshWorkspaceAuthorization(); throw error; } setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== accountId || account.vaultId !== updatedVaultId), unavailableAccounts: current.unavailableAccounts.filter((account) => account.id !== accountId || account.vaultId !== updatedVaultId) } : current); }} />;
}

export function InvitationRedemptionWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  return <SecureShareLinkRedemption userRootKey={workspace.userRootKey} />;
}

export function SharedVaultCreationWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const router = useRouter();
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  return <div className="p-5 sm:p-6"><SharedVaultCreator userRootKey={workspace.userRootKey} onCreated={(vault) => { setWorkspace((current) => current ? { ...current, vaults: [...current.vaults, {
        ...vault,
        type: "SHARED",
        role: "OWNER",
        effectiveAccountPermissions: {
          permissions: ALL_ACCOUNT_PERMISSIONS,
          sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" }
        }
      }] } : current); router.push(`/vaults/manage/${encodeURIComponent(vault.id)}`); }} /></div>;
}

function isPermissionChange(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 403 && error.code === "account_permission_required";
}

function ReadOnlyWorkspaceNotice() {
  const t = useTranslations("AuthenticatorAccount.workspace");
  return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="offline">{t("readOnly")}</StatusBanner><Button variant="outline" asChild><Link href="/vaults">{t("backReadOnly")}</Link></Button></div>;
}

function personalVaultSummary(workspace: NonNullable<ReturnType<typeof useUnlockedVaultWorkspace>["workspace"]>, personalVaultId: string): PersonalVaultSummary | undefined {
  const vault = workspace.vaults.find((entry) => entry.id === personalVaultId && entry.type === "PERSONAL");
  return vault ? {
    id: vault.id,
    name: vault.name,
    accounts: [
      ...workspace.accounts.filter((account) => account.vaultId === vault.id).map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision })),
      ...workspace.unavailableAccounts.filter((account) => account.vaultId === vault.id).map(({ id, revision }) => ({ id, issuer: "", accountName: "", revision, unavailable: true }))
    ]
  } : undefined;
}

function sharedVaultSummaries(workspace: NonNullable<ReturnType<typeof useUnlockedVaultWorkspace>["workspace"]>): SharedVaultSummary[] {
  return workspace.vaults.filter((vault) => vault.type === "SHARED").map((vault) => ({
    id: vault.id,
    name: vault.name,
    role: vault.role,
    effectiveAccountPermissions: vault.effectiveAccountPermissions,
    key: vault.key,
    accounts: [
      ...workspace.accounts.filter((account) => account.vaultId === vault.id).map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision })),
      ...(vault.role === "OWNER" ? workspace.unavailableAccounts.filter((account) => account.vaultId === vault.id).map(({ id, revision }) => ({ id, issuer: "", accountName: "", revision, unavailable: true })) : [])
    ]
  }));
}

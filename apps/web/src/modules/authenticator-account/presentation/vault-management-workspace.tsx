"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ALL_ACCOUNT_PERMISSIONS, SecureShareLinkRedemption } from "@/modules/vault-membership";
import {
  PersonalVaultDetails,
  SharedVaultCreator,
  SharedVaultDetails,
  SharedVaultDirectory,
  type PersonalVaultSummary,
  type SharedVaultSummary,
} from "@/modules/vault-management";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useDeleteEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";
import { AuthenticatorAccountManagerDialog } from "./authenticator-account-manager-dialog";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { VaultWorkspaceUnlock } from "./vault-workspace-unlock";
import type { WorkspaceAuthenticatorAccount } from "@/modules/sync";

export function VaultDirectoryWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  return <SharedVaultDirectory vaults={sharedVaultSummaries(workspace)} />;
}

export function PersonalVaultDetailWorkspace({
  personalVaultId,
  ownerEmail,
}: {
  personalVaultId: string;
  ownerEmail: string;
}) {
  const t = useTranslations("AuthenticatorAccount.workspace");
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const deleteAccount = useDeleteEncryptedAuthenticatorAccountMutation();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  const personalVault = personalVaultSummary(workspace, personalVaultId);
  if (!personalVault)
    return (
      <div className="grid gap-4 p-5 sm:p-6">
        <StatusBanner tone="danger" role="alert">
          {t("personalUnavailable")}
        </StatusBanner>
        <Button variant="outline" asChild>
          <Link href="/vaults/manage">{t("allVaults")}</Link>
        </Button>
      </div>
    );
  const personalVaultKey = workspace.vaults.find(
    (vault) => vault.id === personalVaultId && vault.type === "PERSONAL",
  )?.key;
  if (!personalVaultKey) return <ReadOnlyWorkspaceNotice />;
  return (
    <>
      <PersonalVaultDetails
        vault={personalVault}
        ownerEmail={ownerEmail}
        onAccountEdit={(summary) => {
          const account = workspace.accounts.find(
            (candidate) => candidate.id === summary.id && candidate.vaultId === personalVaultId,
          );
          if (account) setManagedAccount(account);
        }}
        onAccountDeleted={async (vaultId, accountId, expectedRevision) => {
          await deleteAccount.mutateAsync({ vaultId, vaultType: "PERSONAL", accountId, expectedRevision });
          setWorkspace((current) =>
            current
              ? {
                  ...current,
                  accounts: current.accounts.filter(
                    (account) => account.id !== accountId || account.vaultId !== vaultId,
                  ),
                  unavailableAccounts: current.unavailableAccounts.filter(
                    (account) => account.id !== accountId || account.vaultId !== vaultId,
                  ),
                }
              : current,
          );
        }}
      />
      {managedAccount && (
        <WorkspaceAuthenticatorAccountManager
          account={managedAccount}
          vaultKey={personalVaultKey}
          canEdit
          canDelete
          onUpdated={setManagedAccount}
          onClose={() => setManagedAccount(null)}
        />
      )}
    </>
  );
}

export function SharedVaultDetailWorkspace({
  personalVaultId,
  vaultId,
  ownerEmail,
}: {
  personalVaultId: string;
  vaultId: string;
  ownerEmail: string;
}) {
  const t = useTranslations("AuthenticatorAccount.workspace");
  const router = useRouter();
  const { workspace, setWorkspace, refreshWorkspaceAuthorization } = useUnlockedVaultWorkspace();
  const [managedAccount, setManagedAccount] = useState<WorkspaceAuthenticatorAccount | null>(null);
  const deleteAccount = useDeleteEncryptedAuthenticatorAccountMutation();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <ReadOnlyWorkspaceNotice />;
  const vault = sharedVaultSummaries(workspace).find((entry) => entry.id === vaultId);
  if (!vault)
    return (
      <div className="grid gap-4 p-5 sm:p-6">
        <StatusBanner tone="danger" role="alert">
          {t("sharedUnavailable")}
        </StatusBanner>
        <Button variant="outline" asChild>
          <Link href="/vaults/manage">{t("allVaults")}</Link>
        </Button>
      </div>
    );
  return (
    <>
      <SharedVaultDetails
        vault={vault}
        ownerEmail={ownerEmail}
        onAccountEdit={(summary) => {
          const account = workspace.accounts.find(
            (candidate) => candidate.id === summary.id && candidate.vaultId === vaultId,
          );
          if (account) setManagedAccount(account);
        }}
        onRenamed={(updatedVaultId, name) =>
          setWorkspace((current) =>
            current
              ? {
                  ...current,
                  vaults: current.vaults.map((entry) => (entry.id === updatedVaultId ? { ...entry, name } : entry)),
                  accounts: current.accounts.map((account) =>
                    account.vaultId === updatedVaultId ? { ...account, vaultName: name } : account,
                  ),
                }
              : current,
          )
        }
        onAccountDeleted={async (updatedVaultId, accountId, expectedRevision) => {
          try {
            await deleteAccount.mutateAsync({
              vaultId: updatedVaultId,
              vaultType: "SHARED",
              accountId,
              expectedRevision,
            });
          } catch (error) {
            if (isPermissionChange(error)) await refreshWorkspaceAuthorization();
            throw error;
          }
          setWorkspace((current) =>
            current
              ? {
                  ...current,
                  accounts: current.accounts.filter(
                    (account) => account.id !== accountId || account.vaultId !== updatedVaultId,
                  ),
                  unavailableAccounts: current.unavailableAccounts.filter(
                    (account) => account.id !== accountId || account.vaultId !== updatedVaultId,
                  ),
                }
              : current,
          );
        }}
        onDeleted={(deletedVaultId) => {
          setWorkspace((current) => {
            if (!current) return current;
            current.vaults.find((entry) => entry.id === deletedVaultId)?.key.fill(0);
            for (const account of current.accounts) if (account.vaultId === deletedVaultId) account.secret.fill(0);
            return {
              ...current,
              vaults: current.vaults.filter((entry) => entry.id !== deletedVaultId),
              accounts: current.accounts.filter((account) => account.vaultId !== deletedVaultId),
              unavailableAccounts: current.unavailableAccounts.filter((account) => account.vaultId !== deletedVaultId),
            };
          });
          router.push("/vaults/manage");
        }}
      />
      {managedAccount && (
        <WorkspaceAuthenticatorAccountManager
          account={managedAccount}
          vaultKey={vault.key}
          canEdit={vault.effectiveAccountPermissions.permissions.canEditAccounts}
          canDelete={vault.effectiveAccountPermissions.permissions.canDeleteAccounts}
          onPermissionChanged={refreshWorkspaceAuthorization}
          onUpdated={setManagedAccount}
          onClose={() => setManagedAccount(null)}
        />
      )}
    </>
  );
}

function WorkspaceAuthenticatorAccountManager({
  account,
  vaultKey,
  canEdit,
  canDelete,
  onPermissionChanged,
  onUpdated,
  onClose,
}: {
  account: WorkspaceAuthenticatorAccount;
  vaultKey: Uint8Array;
  canEdit: boolean;
  canDelete: boolean;
  onPermissionChanged?: () => Promise<void>;
  onUpdated: (account: WorkspaceAuthenticatorAccount) => void;
  onClose: () => void;
}) {
  const { setWorkspace } = useUnlockedVaultWorkspace();
  return (
    <AuthenticatorAccountManagerDialog
      account={account}
      vaultKey={vaultKey}
      canEdit={canEdit}
      canDelete={canDelete}
      onPermissionChanged={onPermissionChanged}
      onUpdated={(updated) => {
        setWorkspace((current) =>
          current
            ? {
                ...current,
                accounts: current.accounts.map((candidate) =>
                  candidate.id === updated.id && candidate.vaultId === updated.vaultId ? updated : candidate,
                ),
              }
            : current,
        );
        onUpdated(updated);
      }}
      onDeleted={(deleted) =>
        setWorkspace((current) =>
          current
            ? {
                ...current,
                accounts: current.accounts.filter(
                  (candidate) => candidate.id !== deleted.id || candidate.vaultId !== deleted.vaultId,
                ),
                unavailableAccounts: current.unavailableAccounts.filter(
                  (candidate) => candidate.id !== deleted.id || candidate.vaultId !== deleted.vaultId,
                ),
              }
            : current,
        )
      }
      onClose={onClose}
    />
  );
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
  return (
    <div className="p-5 sm:p-6">
      <SharedVaultCreator
        userRootKey={workspace.userRootKey}
        onCreated={(vault) => {
          setWorkspace((current) =>
            current
              ? {
                  ...current,
                  vaults: [
                    ...current.vaults,
                    {
                      ...vault,
                      type: "SHARED",
                      role: "OWNER",
                      effectiveAccountPermissions: {
                        permissions: ALL_ACCOUNT_PERMISSIONS,
                        sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
                      },
                    },
                  ],
                }
              : current,
          );
          router.push(`/vaults/manage/${encodeURIComponent(vault.id)}`);
        }}
      />
    </div>
  );
}

function isPermissionChange(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 403 && error.code === "account_permission_required";
}

function ReadOnlyWorkspaceNotice() {
  const t = useTranslations("AuthenticatorAccount.workspace");
  return (
    <div className="grid gap-4 p-5 sm:p-6">
      <StatusBanner tone="offline">{t("readOnly")}</StatusBanner>
      <Button variant="outline" asChild>
        <Link href="/vaults">{t("backReadOnly")}</Link>
      </Button>
    </div>
  );
}

function personalVaultSummary(
  workspace: NonNullable<ReturnType<typeof useUnlockedVaultWorkspace>["workspace"]>,
  personalVaultId: string,
): PersonalVaultSummary | undefined {
  const vault = workspace.vaults.find((entry) => entry.id === personalVaultId && entry.type === "PERSONAL");
  return vault
    ? {
        id: vault.id,
        name: vault.name,
        accounts: [
          ...workspace.accounts
            .filter((account) => account.vaultId === vault.id)
            .map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision })),
          ...workspace.unavailableAccounts
            .filter((account) => account.vaultId === vault.id)
            .map(({ id, revision }) => ({ id, issuer: "", accountName: "", revision, unavailable: true })),
        ],
      }
    : undefined;
}

function sharedVaultSummaries(
  workspace: NonNullable<ReturnType<typeof useUnlockedVaultWorkspace>["workspace"]>,
): SharedVaultSummary[] {
  return workspace.vaults
    .filter((vault) => vault.type === "SHARED")
    .map((vault) => ({
      id: vault.id,
      name: vault.name,
      role: vault.role,
      effectiveAccountPermissions: vault.effectiveAccountPermissions,
      key: vault.key,
      accounts: [
        ...workspace.accounts
          .filter((account) => account.vaultId === vault.id)
          .map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision })),
        ...(vault.role === "OWNER"
          ? workspace.unavailableAccounts
              .filter((account) => account.vaultId === vault.id)
              .map(({ id, revision }) => ({ id, issuer: "", accountName: "", revision, unavailable: true }))
          : []),
      ],
    }));
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SecureShareLinkRedemption } from "@/modules/vault-membership";
import { SharedVaultCreator, SharedVaultDetails, SharedVaultDirectory, type SharedVaultSummary } from "@/modules/vault-management";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useDeleteEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { VaultWorkspaceUnlock } from "./vault-workspace-unlock";

export function VaultDirectoryWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  return <SharedVaultDirectory vaults={sharedVaultSummaries(workspace)} />;
}

export function SharedVaultDetailWorkspace({ personalVaultId, vaultId }: { personalVaultId: string; vaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const deleteAccount = useDeleteEncryptedAuthenticatorAccountMutation();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  const vault = sharedVaultSummaries(workspace).find((entry) => entry.id === vaultId);
  if (!vault) return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="danger" role="alert">Brankas Bersama tidak ditemukan atau tidak dapat dibuka.</StatusBanner><Button variant="outline" asChild><Link href="/vaults/manage">Lihat semua brankas</Link></Button></div>;
  return <SharedVaultDetails vault={vault} onRenamed={(updatedVaultId, name) => setWorkspace((current) => current ? { ...current, vaults: current.vaults.map((entry) => entry.id === updatedVaultId ? { ...entry, name } : entry), accounts: current.accounts.map((account) => account.vaultId === updatedVaultId ? { ...account, vaultName: name } : account) } : current)} onAccountDeleted={async (updatedVaultId, accountId, expectedRevision) => { await deleteAccount.mutateAsync({ vaultId: updatedVaultId, vaultType: "SHARED", accountId, expectedRevision }); setWorkspace((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== accountId || account.vaultId !== updatedVaultId) } : current); }} />;
}

export function InvitationRedemptionWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  return <SecureShareLinkRedemption userRootKey={workspace.userRootKey} />;
}

export function SharedVaultCreationWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const router = useRouter();
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  return <div className="p-5 sm:p-6"><SharedVaultCreator userRootKey={workspace.userRootKey} onCreated={(vault) => { setWorkspace((current) => current ? { ...current, vaults: [...current.vaults, { ...vault, type: "SHARED", role: "OWNER" }] } : current); router.push(`/vaults/manage/${encodeURIComponent(vault.id)}`); }} /></div>;
}

function sharedVaultSummaries(workspace: NonNullable<ReturnType<typeof useUnlockedVaultWorkspace>["workspace"]>): SharedVaultSummary[] {
  return workspace.vaults.filter((vault) => vault.type === "SHARED").map((vault) => ({ id: vault.id, name: vault.name, role: vault.role, key: vault.key, accounts: workspace.accounts.filter((account) => account.vaultId === vault.id).map(({ id, issuer, accountName, revision }) => ({ id, issuer, accountName, revision })) }));
}

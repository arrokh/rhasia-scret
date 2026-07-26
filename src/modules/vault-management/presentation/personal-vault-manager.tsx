"use client";

import { VaultAccountManagementList, type ManagedVaultAccountSummary } from "./vault-account-management-list";

export type PersonalVaultSummary = { id: string; name: string; accounts: ManagedVaultAccountSummary[] };

export function PersonalVaultDetails({ vault, ownerEmail, onAccountDeleted }: { vault: PersonalVaultSummary; ownerEmail: string; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  return <div className="grid gap-6 p-5 sm:p-6">
    <dl className="grid gap-4 sm:grid-cols-2 sm:gap-6">
      <div className="grid content-start gap-1"><dt className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Pemilik</dt><dd className="break-all text-sm font-bold text-foreground">{ownerEmail}</dd></div>
      <div className="grid content-start gap-1"><dt className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Nama brankas</dt><dd className="text-sm font-bold text-foreground">{vault.name}</dd></div>
    </dl>
    <VaultAccountManagementList vaultId={vault.id} vaultName={vault.name} accounts={vault.accounts} onAccountDeleted={onAccountDeleted} />
  </div>;
}

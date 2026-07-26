"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyRound, Plus, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";

export type ManagedVaultAccountSummary = { id: string; issuer: string; accountName: string; revision: number };

export function VaultAccountManagementList({ vaultId, vaultName, accounts, editable = true, onAudit, onAccountDeleted }: { vaultId: string; vaultName: string; accounts: ManagedVaultAccountSummary[]; editable?: boolean; onAudit?: (account: ManagedVaultAccountSummary) => void; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  const [accountToDelete, setAccountToDelete] = useState<ManagedVaultAccountSummary | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [status, setStatus] = useState("");

  async function removeAccount(account: ManagedVaultAccountSummary) {
    setStatus("");
    setDeletingAccount(true);
    try {
      await onAccountDeleted(vaultId, account.id, account.revision);
      setAccountToDelete(null);
      setStatus("Akun autentikator dihapus.");
    } catch {
      setStatus("Tidak dapat menghapus akun autentikator.");
    } finally {
      setDeletingAccount(false);
    }
  }

  return <>
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Akun</p><h3 className="mt-1 font-bold text-ink-strong">Akun autentikator</h3></div>{editable && <Button size="sm" asChild><Link href={`/vaults/accounts/new?vaultId=${encodeURIComponent(vaultId)}`}><Plus />Tambah akun</Link></Button>}</div>
    {accounts.length ? <ul className="grid list-none gap-2 p-0">{accounts.map((account) => <li key={account.id} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md border bg-card p-2.5"><span className="grid size-10 place-items-center rounded-md bg-muted font-bold text-foreground" aria-hidden="true">{account.issuer.slice(0, 1).toUpperCase()}</span><span className="grid min-w-0"><strong className="truncate text-sm">{account.issuer}</strong><span className="truncate text-xs text-muted-foreground">{account.accountName}</span></span>{(onAudit || editable) && <span className="flex items-center">{onAudit && <Button variant="ghost" size="icon-sm" type="button" aria-label={`Lihat audit ${account.issuer} ${account.accountName}`} onClick={() => onAudit(account)}><ScrollText /></Button>}{editable && <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={`Hapus ${account.issuer} ${account.accountName}`} onClick={() => setAccountToDelete(account)}><Trash2 /></Button>}</span>}</li>)}</ul> : <div className="grid justify-items-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center"><KeyRound className="size-6 text-taupe" /><p className="font-bold">Belum ada akun autentikator</p><p className="text-sm text-muted-foreground">{editable ? `Tambahkan akun pertama ke ${vaultName}.` : "Brankas ini belum memiliki akun."}</p></div>}
    {status && <StatusBanner tone={status.includes("dihapus") ? "success" : "danger"}>{status}</StatusBanner>}
    {accountToDelete && <ConfirmationDialog title="Hapus akun autentikator?" description={`${accountToDelete.issuer} (${accountToDelete.accountName}) akan dihapus dari ${vaultName}. Akun dapat dipulihkan selama masa pemulihan.`} confirmLabel="Hapus akun" danger pending={deletingAccount} onCancel={() => setAccountToDelete(null)} onConfirm={() => void removeAccount(accountToDelete)} />}
  </>;
}

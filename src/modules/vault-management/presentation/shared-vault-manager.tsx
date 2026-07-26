"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft, ChevronRight, Plus, Trash2, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { encryptSharedVaultName } from "../infrastructure/browser-shared-vault-creator";
import { useRenameSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { SharedVaultCreator } from "./shared-vault-creator";

type SharedVaultAccountSummary = { id: string; issuer: string; accountName: string; revision: number };
type SharedVaultSummary = { id: string; name: string; role: "OWNER" | "VIEWER"; key: Uint8Array; accounts: SharedVaultAccountSummary[] };

export function SharedVaultManager({ userRootKey, vaults, onVaultCreated, onVaultRenamed, onAccountDeleted }: { userRootKey: Uint8Array; vaults: SharedVaultSummary[]; onVaultCreated: (vault: { id: string; name: string; key: Uint8Array }) => void; onVaultRenamed: (vaultId: string, name: string) => void; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? null;
  function reset() { setCreating(false); setSelectedVaultId(null); }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
    <DialogTrigger asChild><Button variant="outline" type="button" aria-label="Brankas Bersama"><UsersRound /><span className="hidden sm:inline">Brankas Bersama</span></Button></DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto rounded-lg bg-card p-5" showCloseButton>
      <DialogHeader className="pr-9">
        <div className="flex items-center gap-2">
          {(creating || selectedVault) && <Button variant="ghost" size="icon-sm" type="button" onClick={reset} aria-label="Kembali ke daftar Brankas Bersama"><ArrowLeft /></Button>}
          <div className="min-w-0 flex-1"><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Berbagi</p><DialogTitle className="mt-1 truncate text-xl font-bold text-ink-strong">{creating ? "Buat Brankas Bersama" : selectedVault?.name ?? "Brankas Bersama"}</DialogTitle></div>
          {!creating && !selectedVault && <Button variant="outline" size="icon-sm" type="button" aria-label="Buat Brankas Bersama" onClick={() => setCreating(true)}><Plus /></Button>}
        </div>
        <DialogDescription>{creating ? "Buat ruang kode untuk keluarga atau kelompok tepercaya." : selectedVault ? "Kelola nama dan akun sesuai izin Anda." : "Pilih brankas atau buat yang baru."}</DialogDescription>
      </DialogHeader>
      {creating ? <SharedVaultCreator userRootKey={userRootKey} onCreated={(vault) => { onVaultCreated(vault); setCreating(false); setSelectedVaultId(vault.id); }} onCancel={reset} /> : selectedVault ? <SharedVaultDetails vault={selectedVault} onRenamed={onVaultRenamed} onAccountDeleted={onAccountDeleted} /> : vaults.length ? (
        <ul className="grid list-none gap-2 p-0">{vaults.map((vault) => <li key={vault.id}><Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 p-3 text-left" type="button" onClick={() => setSelectedVaultId(vault.id)}><span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground"><UsersRound /></span><span className="grid min-w-0 flex-1 gap-1"><strong className="truncate text-sm text-foreground">{vault.name}</strong><span className="text-xs font-normal text-muted-foreground">{vault.accounts.length} akun · {vault.role === "OWNER" ? "Pemilik" : "Dapat melihat"}</span></span><Badge className={vault.role === "OWNER" ? "bg-gold-soft text-ink-strong" : "bg-muted text-muted-foreground"}>{vault.role === "OWNER" ? "Pemilik" : "Dapat melihat"}</Badge><ChevronRight className="text-muted-foreground" /></Button></li>)}</ul>
      ) : <div className="grid justify-items-center gap-2 rounded-lg border border-dashed bg-muted/40 p-8 text-center"><UsersRound className="size-7 text-taupe" /><p className="font-bold">Belum ada Brankas Bersama</p><p className="text-sm text-muted-foreground">Buat brankas untuk berbagi kode dengan orang tepercaya.</p><Button className="mt-2" onClick={() => setCreating(true)}><Plus />Buat brankas</Button></div>}
    </DialogContent>
  </Dialog>;
}

function SharedVaultDetails({ vault, onRenamed, onAccountDeleted }: { vault: SharedVaultSummary; onRenamed: (vaultId: string, name: string) => void; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  const [status, setStatus] = useState("");
  const [accountToDelete, setAccountToDelete] = useState<SharedVaultAccountSummary | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const renameMutation = useRenameSharedVaultMutation();
  const renameForm = useForm({ defaultValues: { name: vault.name }, onSubmit: async ({ value }) => { try { const name = value.name.trim(); const encryptedName = await encryptSharedVaultName(vault.key, name); await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) }); onRenamed(vault.id, name); setStatus("Nama brankas diperbarui."); } catch { setStatus("Tidak dapat memperbarui nama brankas."); } } });
  async function removeAccount(account: SharedVaultAccountSummary) { setStatus(""); setDeletingAccount(true); try { await onAccountDeleted(vault.id, account.id, account.revision); setAccountToDelete(null); setStatus("Akun autentikator dihapus."); } catch { setStatus("Tidak dapat menghapus akun autentikator."); } finally { setDeletingAccount(false); } }

  return <div className="grid gap-5">
    {vault.role === "OWNER" ? <form noValidate className="grid gap-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void renameForm.handleSubmit(); }}><renameForm.Field name="name" validators={{ onSubmit: requiredText("Nama Brankas Bersama") }}>{(field) => <><Label htmlFor={`shared-vault-name-${vault.id}`}>Nama Brankas Bersama</Label><div className="grid grid-cols-[1fr_auto] gap-2"><Input id={`shared-vault-name-${vault.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `shared-vault-name-${vault.id}-error` : undefined} required /><Button variant="outline" type="submit" disabled={renameMutation.isPending}>{renameMutation.isPending ? "Menyimpan…" : "Simpan"}</Button></div><FormFieldError id={`shared-vault-name-${vault.id}-error`} errors={field.state.meta.errors} /></>}</renameForm.Field></form> : <StatusBanner tone="info">Anda dapat melihat dan menyalin OTP, tetapi tidak dapat mengubah akun.</StatusBanner>}
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Akun</p><h3 className="mt-1 font-bold text-ink-strong">Akun autentikator</h3></div>{vault.role === "OWNER" && <Button size="sm" asChild><Link href={`/vaults/accounts/new?vaultId=${encodeURIComponent(vault.id)}`}><Plus />Tambah akun</Link></Button>}</div>
    {vault.accounts.length ? <ul className="grid list-none gap-2 p-0">{vault.accounts.map((account) => <li key={account.id} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md border bg-card p-2.5"><span className="grid size-10 place-items-center rounded-md bg-muted font-bold text-foreground" aria-hidden="true">{account.issuer.slice(0, 1).toUpperCase()}</span><span className="grid min-w-0"><strong className="truncate text-sm">{account.issuer}</strong><span className="truncate text-xs text-muted-foreground">{account.accountName}</span></span>{vault.role === "OWNER" && <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={`Hapus ${account.issuer} ${account.accountName}`} onClick={() => setAccountToDelete(account)}><Trash2 /></Button>}</li>)}</ul> : <p className="rounded-md border border-dashed bg-muted/30 p-5 text-center text-sm text-muted-foreground">Brankas bersama ini belum memiliki akun.</p>}
    {status && <StatusBanner tone={status.includes("diperbarui") || status.includes("dihapus") ? "success" : "danger"}>{status}</StatusBanner>}
    {accountToDelete && <ConfirmationDialog title="Hapus akun autentikator?" description={`${accountToDelete.issuer} (${accountToDelete.accountName}) akan dihapus dari ${vault.name}. Akun dapat dipulihkan selama masa pemulihan.`} confirmLabel="Hapus akun" danger pending={deletingAccount} onCancel={() => setAccountToDelete(null)} onConfirm={() => void removeAccount(accountToDelete)} />}
  </div>;
}

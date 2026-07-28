"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Check, ChevronRight, Clipboard, Download, KeyRound, MailPlus, Plus, ScrollText, Trash2, Upload, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createSharedVaultInvitation, useDeleteVaultParticipantMutation, useVaultParticipantsQuery, type BrowserVaultParticipant } from "@/modules/vault-membership";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { encryptSharedVaultName } from "../infrastructure/browser-shared-vault-creator";
import type { VaultAuditFilter } from "../infrastructure/browser-vault-management-client";
import { useRenameSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { useVaultAuditQuery } from "./hooks/use-vault-audit-query";
import { VaultAccountManagementList, type ManagedVaultAccountSummary } from "./vault-account-management-list";
import { VaultAuditHistory, type SelectedAuditFilter } from "./vault-audit-history";

type SharedVaultAccountSummary = ManagedVaultAccountSummary;
export type SharedVaultSummary = { id: string; name: string; role: "OWNER" | "VIEWER"; key: Uint8Array; accounts: SharedVaultAccountSummary[] };

export function SharedVaultDirectory({ vaults }: { vaults: SharedVaultSummary[] }) {
  return <div className="grid gap-5 p-5 sm:p-6">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-ink-strong">Semua brankas</h2><p className="mt-1 text-sm text-muted-foreground">Brankas Pribadi selalu ditampilkan pertama.</p></div><Button size="sm" asChild><Link href="/vaults/manage/new"><Plus />Brankas Bersama</Link></Button></div>
    <nav aria-label="Aksi arsip Brankas" className="grid grid-cols-2 gap-2 sm:ml-auto sm:w-fit">
      <Button variant="outline" size="sm" className="w-full sm:min-w-40" asChild><Link href="/vaults/backup"><Download />Buat cadangan</Link></Button>
      <Button variant="outline" size="sm" className="w-full sm:min-w-40" asChild><Link href="/vaults/import"><Upload />Import arsip</Link></Button>
    </nav>
    <ul className="grid list-none gap-2 p-0">
      <li><VaultDirectoryLink href="/vaults/manage/personal" icon={KeyRound} name="Brankas Pribadi" detail="Pribadi · Pemilik" badge="Pribadi" /></li>
      {vaults.map((vault) => <li key={vault.id}><VaultDirectoryLink href={`/vaults/manage/${encodeURIComponent(vault.id)}`} icon={UsersRound} name={vault.name} detail={`${vault.accounts.length} akun · ${vault.role === "OWNER" ? "Pemilik" : "Dapat melihat"}`} badge={vault.role === "OWNER" ? "Pemilik" : "Viewer"} /></li>)}
    </ul>
  </div>;
}

function VaultDirectoryLink({ href, icon: Icon, name, detail, badge }: { href: string; icon: typeof KeyRound; name: string; detail: string; badge: string }) {
  return <Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 p-3 text-left" asChild><Link href={href}><span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground"><Icon /></span><span className="grid min-w-0 flex-1 gap-1"><strong className="truncate text-sm text-foreground">{name}</strong><span className="text-xs font-normal text-muted-foreground">{detail}</span></span><Badge className="bg-muted text-muted-foreground">{badge}</Badge><ChevronRight className="text-muted-foreground" /></Link></Button>;
}

export function SharedVaultDetails({ vault, onRenamed, onAccountDeleted }: { vault: SharedVaultSummary; onRenamed: (vaultId: string, name: string) => void; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  const [activeTab, setActiveTab] = useState("details");
  const [status, setStatus] = useState("");
  const [auditFilter, setAuditFilter] = useState<SelectedAuditFilter>({ query: {}, label: "" });
  const renameMutation = useRenameSharedVaultMutation();
  const participants = useVaultParticipantsQuery(vault.id, vault.role === "OWNER");
  const participantItems = participants.data?.pages.flatMap((page) => page.participants) ?? [];
  const audit = useVaultAuditQuery(vault.id, auditFilter.query, vault.role === "OWNER" && activeTab === "audit");
  const renameForm = useForm({ defaultValues: { name: vault.name }, onSubmit: async ({ value }) => { try { const name = value.name.trim(); const encryptedName = await encryptSharedVaultName(vault.key, name); await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) }); onRenamed(vault.id, name); setStatus("Nama brankas diperbarui."); } catch { setStatus("Tidak dapat memperbarui nama brankas."); } } });
  const owner = participants.data?.pages[0]?.owner;

  function openAudit(filter: VaultAuditFilter, label: string) { setAuditFilter({ query: filter, label }); setActiveTab("audit"); }

  return <div className="p-5 sm:p-6">
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      {vault.role === "OWNER" && <TabsList className="grid-cols-3">
        <TabsTrigger value="details">Detail</TabsTrigger>
        <TabsTrigger value="invitations">Undangan</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>}
      <TabsContent value="details" className={`grid gap-5 ${vault.role === "OWNER" ? "" : "mt-0"}`}>
        {vault.role === "OWNER" ? <>
          <div className="grid gap-1"><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Pemilik</p><p className="text-sm font-bold text-foreground">{participants.isPending ? "Memuat…" : owner?.email ?? "Tidak tersedia"}</p></div>
          <form noValidate className="grid gap-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void renameForm.handleSubmit(); }}><renameForm.Field name="name" validators={{ onSubmit: requiredText("Nama Brankas Bersama") }}>{(field) => <><Label htmlFor={`shared-vault-name-${vault.id}`}>Nama Brankas Bersama</Label><div className="grid grid-cols-[1fr_auto] gap-2"><Input id={`shared-vault-name-${vault.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `shared-vault-name-${vault.id}-error` : undefined} required /><Button variant="outline" type="submit" disabled={renameMutation.isPending}>{renameMutation.isPending ? "Menyimpan…" : "Simpan"}</Button></div><FormFieldError id={`shared-vault-name-${vault.id}-error`} errors={field.state.meta.errors} /></>}</renameForm.Field></form>
        </> : <StatusBanner tone="info">Anda dapat melihat dan menyalin OTP, tetapi tidak dapat mengubah akun.</StatusBanner>}
        <VaultAccountManagementList vaultId={vault.id} vaultName={vault.name} accounts={vault.accounts} editable={vault.role === "OWNER"} onAudit={vault.role === "OWNER" ? (account) => openAudit({ accountId: account.id }, `${account.issuer} · ${account.accountName}`) : undefined} onAccountDeleted={onAccountDeleted} />
        {status && <StatusBanner tone={status.includes("diperbarui") ? "success" : "danger"}>{status}</StatusBanner>}
      </TabsContent>
      {vault.role === "OWNER" && <TabsContent value="invitations"><InvitationPanel vault={vault} participants={participantItems} loading={participants.isPending} loadingMore={participants.isFetchingNextPage} failed={participants.isError} hasMore={participants.hasNextPage} onLoadMore={() => void participants.fetchNextPage()} onCreated={() => void participants.refetch()} onAudit={(participant) => participant.userId && openAudit({ actorUserId: participant.userId }, participant.email)} /></TabsContent>}
      {vault.role === "OWNER" && <TabsContent value="audit"><VaultAuditHistory audit={audit} accounts={vault.accounts} filter={auditFilter} onClearFilter={() => setAuditFilter({ query: {}, label: "" })} /></TabsContent>}
    </Tabs>
  </div>;
}

function InvitationPanel({ vault, participants, loading, loadingMore, failed, hasMore, onLoadMore, onCreated, onAudit }: { vault: SharedVaultSummary; participants: BrowserVaultParticipant[]; loading: boolean; loadingMore: boolean; failed: boolean; hasMore: boolean; onLoadMore: () => void; onCreated: () => void; onAudit: (participant: BrowserVaultParticipant) => void }) {
  const [participantToDelete, setParticipantToDelete] = useState<BrowserVaultParticipant | null>(null);
  const deleteMutation = useDeleteVaultParticipantMutation(vault.id);
  const invited = participants;
  async function removeParticipant() { if (!participantToDelete) return; await deleteMutation.mutateAsync(participantToDelete); setParticipantToDelete(null); }
  return <div className="grid gap-5">
    <InvitationForm vault={vault} onCreated={onCreated} />
    <section className="grid gap-3" aria-labelledby="invited-users-title">
      <div><h3 id="invited-users-title" className="font-bold text-ink-strong">Pengguna yang diundang</h3><p className="mt-1 text-sm text-muted-foreground">Anggota aktif dan undangan yang masih menunggu.</p></div>
      {loading && <p className="text-sm text-muted-foreground">Memuat pengguna…</p>}
      {failed && <StatusBanner tone="danger" role="alert">{invited.length ? "Pengguna berikutnya tidak dapat dimuat." : "Daftar pengguna tidak dapat dimuat."}</StatusBanner>}
      {!loading && !failed && !invited.length && <p className="rounded-md border border-dashed bg-muted/30 p-5 text-center text-sm text-muted-foreground">Belum ada pengguna yang diundang.</p>}
      {!!invited.length && <ul className="grid list-none gap-2 p-0">{invited.map((participant) => <li key={participant.key} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-card p-3"><span className="grid min-w-0 gap-1"><strong className="truncate text-sm">{participant.email}</strong><Badge className="w-fit bg-muted text-muted-foreground">{participant.kind === "MEMBER" ? "Anggota aktif" : "Menunggu"}</Badge></span><span className="flex items-center"><Button variant="ghost" size="icon-sm" type="button" aria-label={`Lihat audit ${participant.email}`} title={participant.userId ? "Lihat audit pengguna" : "Audit tersedia setelah pengguna masuk"} disabled={!participant.userId} onClick={() => onAudit(participant)}><ScrollText /></Button><Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={`Hapus ${participant.email}`} onClick={() => setParticipantToDelete(participant)}><Trash2 /></Button></span></li>)}</ul>}
      {hasMore && <Button variant="outline" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Memuat pengguna…" : "Muat lebih banyak pengguna"}</Button>}
      {!!invited.length && !hasMore && <p className="text-center text-xs text-muted-foreground" aria-live="polite">Semua pengguna telah dimuat.</p>}
    </section>
    {participantToDelete && <ConfirmationDialog title={participantToDelete.kind === "MEMBER" ? "Cabut akses pengguna?" : "Hapus undangan?"} description={participantToDelete.kind === "MEMBER" ? `${participantToDelete.email} tidak akan dapat membuka Brankas Bersama ini lagi.` : `Tautan undangan untuk ${participantToDelete.email} tidak akan dapat digunakan.`} confirmLabel={participantToDelete.kind === "MEMBER" ? "Cabut akses" : "Hapus undangan"} danger pending={deleteMutation.isPending} onCancel={() => setParticipantToDelete(null)} onConfirm={() => void removeParticipant()} />}
  </div>;
}

function InvitationForm({ vault, onCreated }: { vault: SharedVaultSummary; onCreated: () => void }) {
  const [result, setResult] = useState<{ link: string; copied: boolean } | null>(null);
  const [error, setError] = useState("");
  const form = useForm({ defaultValues: { email: "" }, onSubmit: async ({ value }) => { setError(""); setResult(null); try { const invitation = await createSharedVaultInvitation(vault.id, value.email, vault.key); setResult({ link: `${window.location.origin}/vaults/invitations/redeem#${invitation.secret}`, copied: false }); form.reset(); onCreated(); } catch { setError("Undangan tidak dapat dibuat. Pastikan email telah diundang administrator dan belum memiliki akses atau undangan aktif."); } } });
  async function copyLink() { if (!result) return; try { await navigator.clipboard.writeText(result.link); setResult({ ...result, copied: true }); } catch { setError("Tautan tidak dapat disalin. Salin secara manual."); } }
  return <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <div><h3 className="flex items-center gap-2 font-bold text-ink-strong"><MailPlus className="size-5" />Undang melalui email</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">Buat tautan satu kali untuk pengguna yang telah terdaftar, lalu kirim melalui kanal aman.</p></div>
    <form.Field name="email" validators={{ onSubmit: ({ value }) => /^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : "Masukkan alamat email yang valid." }}>{(field) => <div className="grid gap-2"><Label htmlFor="invitation-email">Email penerima</Label><Input id="invitation-email" type="email" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="email" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "invitation-email-error" : undefined} required /><FormFieldError id="invitation-email-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={pending}>{pending ? "Membuat undangan…" : "Buat undangan"}</Button>}</form.Subscribe>
    {result && <div className="grid gap-2 rounded-md border border-success/20 bg-success-surface p-3"><p className="text-sm font-bold text-success">Tautan undangan siap dikirim</p><output className="break-all rounded-sm bg-card p-2 font-mono text-xs" aria-label="Tautan undangan aman">{result.link}</output><Button variant="outline" type="button" onClick={() => void copyLink()}>{result.copied ? <Check /> : <Clipboard />}{result.copied ? "Disalin" : "Salin tautan"}</Button></div>}
    {error && <StatusBanner tone="danger" role="alert">{error}</StatusBanner>}
  </form>;
}

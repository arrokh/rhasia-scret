"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Check, ChevronRight, Clipboard, History, KeyRound, MailPlus, Plus, ScrollText, Trash2, UsersRound, X } from "lucide-react";
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

type SharedVaultAccountSummary = { id: string; issuer: string; accountName: string; revision: number };
export type SharedVaultSummary = { id: string; name: string; role: "OWNER" | "VIEWER"; key: Uint8Array; accounts: SharedVaultAccountSummary[] };
type SelectedAuditFilter = { query: VaultAuditFilter; label: string };

export function SharedVaultDirectory({ vaults }: { vaults: SharedVaultSummary[] }) {
  return <div className="grid gap-5 p-5 sm:p-6">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-ink-strong">Semua brankas</h2><p className="mt-1 text-sm text-muted-foreground">Brankas Pribadi selalu ditampilkan pertama.</p></div><Button size="sm" asChild><Link href="/vaults/manage/new"><Plus />Brankas Bersama</Link></Button></div>
    <ul className="grid list-none gap-2 p-0">
      <li><VaultDirectoryLink href="/vaults" icon={KeyRound} name="Brankas Pribadi" detail="Pribadi · Pemilik" badge="Pribadi" /></li>
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
  const [accountToDelete, setAccountToDelete] = useState<SharedVaultAccountSummary | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [auditFilter, setAuditFilter] = useState<SelectedAuditFilter>({ query: {}, label: "" });
  const renameMutation = useRenameSharedVaultMutation();
  const participants = useVaultParticipantsQuery(vault.id, vault.role === "OWNER");
  const audit = useVaultAuditQuery(vault.id, auditFilter.query, vault.role === "OWNER" && activeTab === "audit");
  const renameForm = useForm({ defaultValues: { name: vault.name }, onSubmit: async ({ value }) => { try { const name = value.name.trim(); const encryptedName = await encryptSharedVaultName(vault.key, name); await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) }); onRenamed(vault.id, name); setStatus("Nama brankas diperbarui."); } catch { setStatus("Tidak dapat memperbarui nama brankas."); } } });
  const owner = participants.data?.find((participant) => participant.kind === "OWNER");

  async function removeAccount(account: SharedVaultAccountSummary) { setStatus(""); setDeletingAccount(true); try { await onAccountDeleted(vault.id, account.id, account.revision); setAccountToDelete(null); setStatus("Akun autentikator dihapus."); } catch { setStatus("Tidak dapat menghapus akun autentikator."); } finally { setDeletingAccount(false); } }
  function openAudit(filter: VaultAuditFilter, label: string) { setAuditFilter({ query: filter, label }); setActiveTab("audit"); }

  return <div className="p-5 sm:p-6">
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className={vault.role === "OWNER" ? "grid-cols-3" : "grid-cols-1"}>
        <TabsTrigger value="details">Detail</TabsTrigger>
        {vault.role === "OWNER" && <TabsTrigger value="invitations">Undangan</TabsTrigger>}
        {vault.role === "OWNER" && <TabsTrigger value="audit">Audit</TabsTrigger>}
      </TabsList>
      <TabsContent value="details" className="grid gap-5">
        {vault.role === "OWNER" ? <>
          <div className="grid gap-1"><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Pemilik</p><p className="text-sm font-bold text-foreground">{participants.isPending ? "Memuat…" : owner?.email ?? "Tidak tersedia"}</p></div>
          <form noValidate className="grid gap-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void renameForm.handleSubmit(); }}><renameForm.Field name="name" validators={{ onSubmit: requiredText("Nama Brankas Bersama") }}>{(field) => <><Label htmlFor={`shared-vault-name-${vault.id}`}>Nama Brankas Bersama</Label><div className="grid grid-cols-[1fr_auto] gap-2"><Input id={`shared-vault-name-${vault.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `shared-vault-name-${vault.id}-error` : undefined} required /><Button variant="outline" type="submit" disabled={renameMutation.isPending}>{renameMutation.isPending ? "Menyimpan…" : "Simpan"}</Button></div><FormFieldError id={`shared-vault-name-${vault.id}-error`} errors={field.state.meta.errors} /></>}</renameForm.Field></form>
        </> : <StatusBanner tone="info">Anda dapat melihat dan menyalin OTP, tetapi tidak dapat mengubah akun.</StatusBanner>}
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Akun</p><h3 className="mt-1 font-bold text-ink-strong">Akun autentikator</h3></div>{vault.role === "OWNER" && <Button size="sm" asChild><Link href={`/vaults/accounts/new?vaultId=${encodeURIComponent(vault.id)}`}><Plus />Tambah akun</Link></Button>}</div>
        {vault.accounts.length ? <ul className="grid list-none gap-2 p-0">{vault.accounts.map((account) => <li key={account.id} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md border bg-card p-2.5"><span className="grid size-10 place-items-center rounded-md bg-muted font-bold text-foreground" aria-hidden="true">{account.issuer.slice(0, 1).toUpperCase()}</span><span className="grid min-w-0"><strong className="truncate text-sm">{account.issuer}</strong><span className="truncate text-xs text-muted-foreground">{account.accountName}</span></span>{vault.role === "OWNER" && <span className="flex items-center"><Button variant="ghost" size="icon-sm" type="button" aria-label={`Lihat audit ${account.issuer} ${account.accountName}`} onClick={() => openAudit({ accountId: account.id }, `${account.issuer} · ${account.accountName}`)}><ScrollText /></Button><Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={`Hapus ${account.issuer} ${account.accountName}`} onClick={() => setAccountToDelete(account)}><Trash2 /></Button></span>}</li>)}</ul> : <p className="rounded-md border border-dashed bg-muted/30 p-5 text-center text-sm text-muted-foreground">Brankas bersama ini belum memiliki akun.</p>}
        {status && <StatusBanner tone={status.includes("diperbarui") || status.includes("dihapus") ? "success" : "danger"}>{status}</StatusBanner>}
      </TabsContent>
      {vault.role === "OWNER" && <TabsContent value="invitations"><InvitationPanel vault={vault} participants={participants.data ?? []} loading={participants.isPending} failed={participants.isError} onCreated={() => void participants.refetch()} onAudit={(participant) => participant.userId && openAudit({ actorUserId: participant.userId }, participant.email)} /></TabsContent>}
      {vault.role === "OWNER" && <TabsContent value="audit"><AuditHistory audit={audit} accounts={vault.accounts} filter={auditFilter} onClearFilter={() => setAuditFilter({ query: {}, label: "" })} /></TabsContent>}
    </Tabs>
    {accountToDelete && <ConfirmationDialog title="Hapus akun autentikator?" description={`${accountToDelete.issuer} (${accountToDelete.accountName}) akan dihapus dari ${vault.name}. Akun dapat dipulihkan selama masa pemulihan.`} confirmLabel="Hapus akun" danger pending={deletingAccount} onCancel={() => setAccountToDelete(null)} onConfirm={() => void removeAccount(accountToDelete)} />}
  </div>;
}

function InvitationPanel({ vault, participants, loading, failed, onCreated, onAudit }: { vault: SharedVaultSummary; participants: BrowserVaultParticipant[]; loading: boolean; failed: boolean; onCreated: () => void; onAudit: (participant: BrowserVaultParticipant) => void }) {
  const [participantToDelete, setParticipantToDelete] = useState<BrowserVaultParticipant | null>(null);
  const deleteMutation = useDeleteVaultParticipantMutation(vault.id);
  const invited = participants.filter((participant) => participant.kind !== "OWNER");
  async function removeParticipant() { if (!participantToDelete) return; await deleteMutation.mutateAsync(participantToDelete); setParticipantToDelete(null); }
  return <div className="grid gap-5">
    <InvitationForm vault={vault} onCreated={onCreated} />
    <section className="grid gap-3" aria-labelledby="invited-users-title">
      <div><h3 id="invited-users-title" className="font-bold text-ink-strong">Pengguna yang diundang</h3><p className="mt-1 text-sm text-muted-foreground">Anggota aktif dan undangan yang masih menunggu.</p></div>
      {loading && <p className="text-sm text-muted-foreground">Memuat pengguna…</p>}
      {failed && <StatusBanner tone="danger" role="alert">Daftar pengguna tidak dapat dimuat.</StatusBanner>}
      {!loading && !failed && !invited.length && <p className="rounded-md border border-dashed bg-muted/30 p-5 text-center text-sm text-muted-foreground">Belum ada pengguna yang diundang.</p>}
      {!!invited.length && <ul className="grid list-none gap-2 p-0">{invited.map((participant) => <li key={participant.key} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-card p-3"><span className="grid min-w-0 gap-1"><strong className="truncate text-sm">{participant.email}</strong><Badge className="w-fit bg-muted text-muted-foreground">{participant.kind === "MEMBER" ? "Anggota aktif" : "Menunggu"}</Badge></span><span className="flex items-center"><Button variant="ghost" size="icon-sm" type="button" aria-label={`Lihat audit ${participant.email}`} title={participant.userId ? "Lihat audit pengguna" : "Audit tersedia setelah pengguna masuk"} disabled={!participant.userId} onClick={() => onAudit(participant)}><ScrollText /></Button><Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={`Hapus ${participant.email}`} onClick={() => setParticipantToDelete(participant)}><Trash2 /></Button></span></li>)}</ul>}
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

function AuditHistory({ audit, accounts, filter, onClearFilter }: { audit: ReturnType<typeof useVaultAuditQuery>; accounts: SharedVaultAccountSummary[]; filter: SelectedAuditFilter; onClearFilter: () => void }) {
  const filterNotice = filter.label && <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"><span className="truncate">Filter: <strong>{filter.label}</strong></span><Button variant="ghost" size="icon-xs" type="button" aria-label="Hapus filter audit" onClick={onClearFilter}><X /></Button></div>;
  if (audit.isPending) return <>{filterNotice}<p className="text-sm text-muted-foreground">Memuat riwayat audit…</p></>;
  if (audit.isError) return <>{filterNotice}<StatusBanner tone="danger" role="alert">Riwayat audit tidak dapat dimuat.</StatusBanner></>;
  if (!audit.data?.length) return <>{filterNotice}<div className="grid justify-items-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-center"><History className="size-6 text-taupe" /><p className="font-bold">Belum ada aktivitas</p><p className="text-sm text-muted-foreground">Tidak ada aktivitas yang cocok dengan filter ini.</p></div></>;
  return <>{filterNotice}<ul className="grid list-none gap-2 p-0">{audit.data.map((event) => <li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-md border bg-card p-3"><p className="min-w-0 text-xs text-muted-foreground"><span className="break-all">{event.actorEmail}</span> · {formatJakartaAuditTime(event.createdAt)}</p><p className="text-right text-sm font-bold text-foreground">{auditEventLabel(event.eventType)}</p>{event.targetId && <p className="text-xs text-muted-foreground">{accountAuditLabel(accounts, event.targetId)}</p>}<p className="col-start-2 text-right text-xs text-muted-foreground">{relativeAuditTime(event.createdAt)}</p></li>)}</ul></>;
}

function accountAuditLabel(accounts: SharedVaultAccountSummary[], targetId: string): string {
  const account = accounts.find((entry) => entry.id === targetId);
  return account ? `${account.issuer} · ${account.accountName}` : `Akun ${targetId}`;
}

function auditEventLabel(eventType: string): string {
  if (eventType === "ACCOUNT_ACCESSED") return "Akun autentikator disalin";
  if (eventType === "VAULT_CREATED") return "Brankas dibuat";
  if (eventType === "ACCOUNT_ADDED") return "Akun ditambahkan";
  if (eventType === "MEMBER_REVOKED") return "Akses anggota dicabut";
  if (eventType === "VAULT_DELETED") return "Brankas dihapus";
  if (eventType === "VAULT_RESTORED") return "Brankas dipulihkan";
  return "Aktivitas keamanan";
}

function formatJakartaAuditTime(value: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function relativeAuditTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  if (absoluteSeconds < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  const weeks = Math.round(days / 7);
  if (Math.abs(weeks) < 5) return formatter.format(weeks, "week");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(days / 365), "year");
}

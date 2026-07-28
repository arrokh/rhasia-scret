"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Clipboard, Download, KeyRound, MailPlus, Plus, ScrollText, Settings2, Trash2, Upload, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createSharedVaultInvitation,
  useDeleteVaultParticipantMutation,
  useUpdateVaultDefaultAccountPermissionsMutation,
  useUpdateVaultMemberAccountPermissionOverridesMutation,
  useVaultDefaultAccountPermissionsQuery,
  useVaultParticipantsQuery,
  type BrowserVaultParticipant,
  type EffectiveSharedVaultAccountPermissions,
  type SharedVaultAccountPermissions
} from "@/modules/vault-membership";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { FormLoadingPlaceholder, SectionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";
import { encryptSharedVaultName } from "../infrastructure/browser-shared-vault-creator";
import type { VaultAuditFilter } from "../infrastructure/browser-vault-management-client";
import { useRenameSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { useVaultAuditQuery } from "./hooks/use-vault-audit-query";
import { VaultAccountManagementList, type ManagedVaultAccountSummary } from "./vault-account-management-list";
import { VaultAuditHistory, type SelectedAuditFilter } from "./vault-audit-history";

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
  return <div className="grid gap-5 p-5 sm:p-6">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-ink-strong">{t("title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div><Button size="sm" asChild><Link href="/vaults/manage/new"><Plus />{t("shared")}</Link></Button></div>
    <nav aria-label={t("archiveActions")} className="grid grid-cols-2 gap-2 sm:ml-auto sm:w-fit">
      <Button variant="outline" size="sm" className="w-full sm:min-w-40" asChild><Link href="/vaults/backup"><Download />{t("backup")}</Link></Button>
      <Button variant="outline" size="sm" className="w-full sm:min-w-40" asChild><Link href="/vaults/import"><Upload />{t("importArchive")}</Link></Button>
    </nav>
    <ul className="grid list-none gap-2 p-0">
      <li><VaultDirectoryLink href="/vaults/manage/personal" icon={KeyRound} name={t("personalVault")} detail={t("personalOwner")} badge={t("personal")} /></li>
      {vaults.map((vault) => { const memberCanChangeAccounts = Object.values(vault.effectiveAccountPermissions.permissions).some(Boolean); const role = vault.role === "OWNER" ? t("owner") : memberCanChangeAccounts ? t("memberWithPermissions") : t("canView"); return <li key={vault.id}><VaultDirectoryLink href={`/vaults/manage/${encodeURIComponent(vault.id)}`} icon={UsersRound} name={vault.name} detail={t("detail", { count: vault.accounts.length, role })} badge={vault.role === "OWNER" ? t("owner") : t("viewer")} /></li>; })}
    </ul>
  </div>;
}

function VaultDirectoryLink({ href, icon: Icon, name, detail, badge }: { href: string; icon: typeof KeyRound; name: string; detail: string; badge: string }) {
  return <Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 p-3 text-left" asChild><Link href={href}><span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground"><Icon /></span><span className="grid min-w-0 flex-1 gap-1"><strong className="truncate text-sm text-foreground">{name}</strong><span className="text-xs font-normal text-muted-foreground">{detail}</span></span><Badge className="bg-muted text-muted-foreground">{badge}</Badge><ChevronRight className="text-muted-foreground" /></Link></Button>;
}

export function SharedVaultDetails({ vault, ownerEmail, initialDefaultAccountPermissions, onRenamed, onAccountDeleted }: { vault: SharedVaultSummary; ownerEmail: string; initialDefaultAccountPermissions?: { permissions: SharedVaultAccountPermissions; revision: number }; onRenamed: (vaultId: string, name: string) => void; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  const t = useTranslations("VaultManagement.details");
  const permissionsT = useTranslations("VaultManagement.permissions");
  const [activeTab, setActiveTab] = useState("details");
  const [status, setStatus] = useState<"renamed" | "renameError" | null>(null);
  const [auditFilter, setAuditFilter] = useState<SelectedAuditFilter>({ query: {}, label: "" });
  const renameMutation = useRenameSharedVaultMutation();
  const defaults = useVaultDefaultAccountPermissionsQuery(vault.id, vault.role === "OWNER" && !initialDefaultAccountPermissions);
  const participants = useVaultParticipantsQuery(vault.id, vault.role === "OWNER" && activeTab === "invitations");
  const participantItems = participants.data?.pages.flatMap((page) => page.participants) ?? [];
  const audit = useVaultAuditQuery(vault.id, auditFilter.query, vault.role === "OWNER" && activeTab === "audit");
  const renameForm = useForm({ defaultValues: { name: vault.name }, onSubmit: async ({ value }) => { try { const name = value.name.trim(); const encryptedName = await encryptSharedVaultName(vault.key, name); await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) }); onRenamed(vault.id, name); setStatus("renamed"); } catch { setStatus("renameError"); } } });
  const defaultPermissionState = initialDefaultAccountPermissions ?? (defaults.data ? { permissions: defaults.data.vaultDefaultAccountPermissions, revision: defaults.data.vaultDefaultAccountPermissionsRevision } : undefined);

  function openAudit(filter: VaultAuditFilter, label: string) { setAuditFilter({ query: filter, label }); setActiveTab("audit"); }

  return <div className="p-5 sm:p-6">
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      {vault.role === "OWNER" && <TabsList className="grid-cols-3">
        <TabsTrigger value="details">{t("detailTab")}</TabsTrigger>
        <TabsTrigger value="invitations">{t("invitationsTab")}</TabsTrigger>
        <TabsTrigger value="audit">{t("auditTab")}</TabsTrigger>
      </TabsList>}
      <TabsContent value="details" className={`grid gap-5 ${vault.role === "OWNER" ? "" : "mt-0"}`}>
        {vault.role === "OWNER" ? <>
          <div className="grid gap-1"><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("owner")}</p><p className="text-sm font-bold text-foreground">{ownerEmail}</p></div>
          <form noValidate className="grid gap-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void renameForm.handleSubmit(); }}><renameForm.Field name="name" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("nameRequired") }}>{(field) => <><Label htmlFor={`shared-vault-name-${vault.id}`}>{t("sharedName")}</Label><div className="grid grid-cols-[1fr_auto] gap-2"><Input id={`shared-vault-name-${vault.id}`} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? `shared-vault-name-${vault.id}-error` : undefined} required /><Button variant="outline" type="submit" disabled={renameMutation.isPending}>{renameMutation.isPending ? t("saving") : t("save")}</Button></div><FormFieldError id={`shared-vault-name-${vault.id}-error`} errors={field.state.meta.errors} /></>}</renameForm.Field></form>
          {defaults.isPending && !initialDefaultAccountPermissions && <FormLoadingPlaceholder />}
          {defaults.isError && !initialDefaultAccountPermissions && <StatusBanner tone="danger" role="alert">{permissionsT("loadingError")}</StatusBanner>}
          {defaultPermissionState && <VaultDefaultPermissionsForm key={defaultPermissionState.revision} vaultId={vault.id} permissions={defaultPermissionState.permissions} revision={defaultPermissionState.revision} />}
        </> : <MemberPermissionNotice effective={vault.effectiveAccountPermissions} />}
        {vault.accounts.some((account) => account.unavailable) && <StatusBanner tone="warning" role="status">{t("unavailableAccountWarning")}</StatusBanner>}
        <VaultAccountManagementList
          vaultId={vault.id}
          vaultName={vault.name}
          accounts={vault.accounts}
          canAddAccounts={vault.effectiveAccountPermissions.permissions.canAddAccounts}
          canDeleteAccounts={vault.effectiveAccountPermissions.permissions.canDeleteAccounts}
          onAudit={vault.role === "OWNER" ? (account) => openAudit({ accountId: account.id }, account.unavailable ? account.id : `${account.issuer} · ${account.accountName}`) : undefined}
          onAccountDeleted={onAccountDeleted}
        />
        {status && <StatusBanner tone={status === "renamed" ? "success" : "danger"}>{t(status)}</StatusBanner>}
      </TabsContent>
      {vault.role === "OWNER" && <TabsContent value="invitations"><InvitationPanel vault={vault} participants={participantItems} loading={participants.isPending} loadingMore={participants.isFetchingNextPage} failed={participants.isError} hasMore={participants.hasNextPage} onLoadMore={() => void participants.fetchNextPage()} onCreated={() => void participants.refetch()} onAudit={(participant) => participant.userId && openAudit({ actorUserId: participant.userId }, participant.email)} /></TabsContent>}
      {vault.role === "OWNER" && <TabsContent value="audit"><VaultAuditHistory audit={audit} accounts={vault.accounts} filter={auditFilter} onClearFilter={() => setAuditFilter({ query: {}, label: "" })} /></TabsContent>}
    </Tabs>
  </div>;
}

function VaultDefaultPermissionsForm({ vaultId, permissions, revision }: { vaultId: string; permissions: SharedVaultAccountPermissions; revision: number }) {
  const t = useTranslations("VaultManagement.permissions");
  const mutation = useUpdateVaultDefaultAccountPermissionsMutation(vaultId);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const form = useForm({
    defaultValues: { ...permissions },
    onSubmit: async ({ value }) => {
      setStatus(null);
      try {
        await mutation.mutateAsync({ expectedRevision: revision, permissions: value });
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }
  });
  return <form noValidate className="grid gap-3 rounded-md border bg-muted/30 p-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <div><h3 className="font-bold text-foreground">{t("defaultsTitle")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("defaultsDescription")}</p></div>
    <div className="grid gap-3 sm:grid-cols-3">{permissionFields.map(({ name, label, description }) => <form.Field key={name} name={name}>{(field) => <label className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md bg-card p-3" htmlFor={`vault-default-${name}`}><Checkbox id={`vault-default-${name}`} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} aria-describedby={`vault-default-${name}-description`} /><span><span className="block text-sm font-bold">{t(label)}</span><span id={`vault-default-${name}-description`} className="mt-1 block text-xs leading-4 text-muted-foreground">{t(description)}</span></span></label>}</form.Field>)}</div>
    <Button className="justify-self-start" type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? t("saving") : t("saveDefaults")}</Button>
    {status && <StatusBanner tone={status === "saved" ? "success" : "danger"} role={status === "saved" ? "status" : "alert"}>{t(status)}</StatusBanner>}
  </form>;
}

function MemberPermissionsDialog({ vaultId, participant, onClose }: { vaultId: string; participant: BrowserVaultParticipant; onClose: () => void }) {
  const t = useTranslations("VaultManagement.permissions");
  const mutation = useUpdateVaultMemberAccountPermissionOverridesMutation(vaultId);
  const [status, setStatus] = useState<"error" | null>(null);
  const overrides = participant.permissionOverrides;
  const effective = participant.effectiveAccountPermissions;
  const revision = participant.permissionsRevision;
  const form = useForm({
    defaultValues: {
      canAddAccounts: overrideChoice(overrides?.canAddAccounts ?? null),
      canEditAccounts: overrideChoice(overrides?.canEditAccounts ?? null),
      canDeleteAccounts: overrideChoice(overrides?.canDeleteAccounts ?? null)
    },
    onSubmit: async ({ value }) => {
      if (!participant.userId || !revision) return;
      setStatus(null);
      try {
        await mutation.mutateAsync({
          memberUserId: participant.userId,
          expectedRevision: revision,
          overrides: {
            canAddAccounts: overrideValue(value.canAddAccounts),
            canEditAccounts: overrideValue(value.canEditAccounts),
            canDeleteAccounts: overrideValue(value.canDeleteAccounts)
          }
        });
        onClose();
      } catch {
        setStatus("error");
      }
    }
  });
  if (!participant.userId || !overrides || !effective || !revision) return null;
  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{t("memberTitle")}</DialogTitle><DialogDescription>{t("memberDescription", { email: participant.email })}</DialogDescription></DialogHeader>
      <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
        {permissionFields.map(({ name, label, impact }) => <form.Field key={name} name={name}>{(field) => <div className="grid gap-2"><Label htmlFor={`member-permission-${name}`}>{t(label)}</Label><Select value={field.state.value} onValueChange={(value) => field.handleChange(value as OverrideChoice)}><SelectTrigger id={`member-permission-${name}`} className="w-full" aria-describedby={`member-permission-${name}-description`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="INHERIT">{t("inherit")}</SelectItem><SelectItem value="ALLOW">{t("allow")}</SelectItem><SelectItem value="DENY">{t("deny")}</SelectItem></SelectContent></Select><p id={`member-permission-${name}-description`} className="text-xs leading-4 text-muted-foreground">{t(impact)} {t("current", { value: effective.permissions[name] ? t("allowed") : t("denied"), source: t(effective.sources[name] === "MEMBER" ? "memberSource" : "vaultSource") })}</p></div>}</form.Field>)}
        {status && <StatusBanner tone="danger" role="alert">{t(status)}</StatusBanner>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>{t("cancel")}</Button><Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? t("saving") : t("saveMember")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function MemberPermissionNotice({ effective }: { effective: EffectiveSharedVaultAccountPermissions }) {
  const t = useTranslations("VaultManagement.permissions");
  return <StatusBanner tone="info" title={t("yourTitle")}><span>{t("yourDescription")}</span><span className="mt-2 block"><PermissionSummary permissions={effective.permissions} /></span></StatusBanner>;
}

function PermissionSummary({ permissions }: { permissions: SharedVaultAccountPermissions }) {
  const t = useTranslations("VaultManagement.permissions");
  const allowed = permissionFields.filter(({ name }) => permissions[name]).map(({ summary }) => t(summary));
  return <>{allowed.length ? allowed.join(", ") : t("viewOnly")}</>;
}

type PermissionField = keyof SharedVaultAccountPermissions;
type OverrideChoice = "INHERIT" | "ALLOW" | "DENY";
const permissionFields = [
  { name: "canAddAccounts", label: "addLabel", description: "addDescription", impact: "addImpact", summary: "addSummary" },
  { name: "canEditAccounts", label: "editLabel", description: "editDescription", impact: "editImpact", summary: "editSummary" },
  { name: "canDeleteAccounts", label: "deleteLabel", description: "deleteDescription", impact: "deleteImpact", summary: "deleteSummary" }
] as const satisfies ReadonlyArray<{ name: PermissionField; label: string; description: string; impact: string; summary: string }>;
function overrideChoice(value: boolean | null): OverrideChoice { return value === null ? "INHERIT" : value ? "ALLOW" : "DENY"; }
function overrideValue(value: OverrideChoice): boolean | null { return value === "INHERIT" ? null : value === "ALLOW"; }

function InvitationPanel({ vault, participants, loading, loadingMore, failed, hasMore, onLoadMore, onCreated, onAudit }: { vault: SharedVaultSummary; participants: BrowserVaultParticipant[]; loading: boolean; loadingMore: boolean; failed: boolean; hasMore: boolean; onLoadMore: () => void; onCreated: () => void; onAudit: (participant: BrowserVaultParticipant) => void }) {
  const t = useTranslations("VaultManagement.invitations");
  const [participantToDelete, setParticipantToDelete] = useState<BrowserVaultParticipant | null>(null);
  const [participantToConfigure, setParticipantToConfigure] = useState<BrowserVaultParticipant | null>(null);
  const deleteMutation = useDeleteVaultParticipantMutation(vault.id);
  const invited = participants;
  async function removeParticipant() { if (!participantToDelete) return; await deleteMutation.mutateAsync(participantToDelete); setParticipantToDelete(null); }
  return <div className="grid gap-5">
    <InvitationForm vault={vault} onCreated={onCreated} />
    <section className="grid gap-3" aria-labelledby="invited-users-title">
      <div><h3 id="invited-users-title" className="font-bold text-ink-strong">{t("usersTitle")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("usersDescription")}</p></div>
      {loading && <SectionLoadingPlaceholder rows={2} label={t("loading")} />}
      {failed && <StatusBanner tone="danger" role="alert">{t(invited.length ? "nextError" : "listError")}</StatusBanner>}
      {!loading && !failed && !invited.length && <p className="rounded-md border border-dashed bg-muted/30 p-5 text-center text-sm text-muted-foreground">{t("empty")}</p>}
      {!!invited.length && <ul className="grid list-none gap-2 p-0">{invited.map((participant) => <li key={participant.key} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-card p-3"><span className="grid min-w-0 gap-1"><strong className="truncate text-sm">{participant.email}</strong><span className="flex flex-wrap items-center gap-2"><Badge className="w-fit bg-muted text-muted-foreground">{participant.kind === "MEMBER" ? t("active") : t("pending")}</Badge>{participant.effectiveAccountPermissions && <span className="text-xs text-muted-foreground"><PermissionSummary permissions={participant.effectiveAccountPermissions.permissions} /></span>}</span></span><span className="flex items-center">{participant.kind === "MEMBER" && <Button variant="ghost" size="icon-sm" type="button" aria-label={t("configurePermissions", { email: participant.email })} onClick={() => setParticipantToConfigure(participant)}><Settings2 /></Button>}<Button variant="ghost" size="icon-sm" type="button" aria-label={t("viewAudit", { email: participant.email })} title={participant.userId ? t("viewAuditTitle") : t("auditUnavailable")} disabled={!participant.userId} onClick={() => onAudit(participant)}><ScrollText /></Button><Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={t("deleteLabel", { email: participant.email })} onClick={() => setParticipantToDelete(participant)}><Trash2 /></Button></span></li>)}</ul>}
      {hasMore && <Button variant="outline" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? t("loading") : t("loadMore")}</Button>}
      {!!invited.length && !hasMore && <p className="text-center text-xs text-muted-foreground" aria-live="polite">{t("allLoaded")}</p>}
    </section>
    {participantToDelete && <ConfirmationDialog title={participantToDelete.kind === "MEMBER" ? t("revokeTitle") : t("deleteTitle")} description={participantToDelete.kind === "MEMBER" ? t("revokeDescription", { email: participantToDelete.email }) : t("deleteDescription", { email: participantToDelete.email })} confirmLabel={participantToDelete.kind === "MEMBER" ? t("revoke") : t("delete")} danger pending={deleteMutation.isPending} onCancel={() => setParticipantToDelete(null)} onConfirm={() => void removeParticipant()} />}
    {participantToConfigure?.userId && participantToConfigure.permissionOverrides && participantToConfigure.effectiveAccountPermissions && participantToConfigure.permissionsRevision && <MemberPermissionsDialog key={`${participantToConfigure.userId}:${participantToConfigure.permissionsRevision}`} vaultId={vault.id} participant={participantToConfigure} onClose={() => setParticipantToConfigure(null)} />}
  </div>;
}

function InvitationForm({ vault, onCreated }: { vault: SharedVaultSummary; onCreated: () => void }) {
  const t = useTranslations("VaultManagement.invitations");
  const [result, setResult] = useState<{ link: string; copied: boolean } | null>(null);
  const [error, setError] = useState<"createError" | "copyError" | null>(null);
  const form = useForm({ defaultValues: { email: "" }, onSubmit: async ({ value }) => { setError(null); setResult(null); try { const invitation = await createSharedVaultInvitation(vault.id, value.email, vault.key); setResult({ link: `${window.location.origin}/vaults/invitations/redeem#${invitation.secret}`, copied: false }); form.reset(); onCreated(); } catch { setError("createError"); } } });
  async function copyLink() { if (!result) return; try { await navigator.clipboard.writeText(result.link); setResult({ ...result, copied: true }); } catch { setError("copyError"); } }
  return <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <div><h3 className="flex items-center gap-2 font-bold text-ink-strong"><MailPlus className="size-5" />{t("formTitle")}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("formDescription")}</p></div>
    <form.Field name="email" validators={{ onSubmit: ({ value }) => /^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : t("invalidEmail") }}>{(field) => <div className="grid gap-2"><Label htmlFor="invitation-email">{t("recipientEmail")}</Label><Input id="invitation-email" type="email" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="email" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "invitation-email-error" : undefined} required /><FormFieldError id="invitation-email-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={pending}>{pending ? t("creating") : t("create")}</Button>}</form.Subscribe>
    {result && <div className="grid gap-2 rounded-md border border-success/20 bg-success-surface p-3"><p className="text-sm font-bold text-success">{t("ready")}</p><output className="break-all rounded-sm bg-card p-2 font-mono text-xs" aria-label={t("secureLink")}>{result.link}</output><Button variant="outline" type="button" onClick={() => void copyLink()}>{result.copied ? <Check /> : <Clipboard />}{result.copied ? t("copied") : t("copy")}</Button></div>}
    {error && <StatusBanner tone="danger" role="alert">{t(error)}</StatusBanner>}
  </form>;
}

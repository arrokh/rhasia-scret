"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronRight, Clipboard, ClipboardX, DatabaseBackup, Import, KeyRound, MailPlus, Plus, RefreshCw, ScrollText, Settings2, Trash2, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { useDeleteSharedVaultMutation, useRenameSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
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
    <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0"><h2 className="text-lg font-bold text-ink-strong">{t("title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div>
      <nav aria-label={t("archiveActions")} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:shrink-0">
        <Button variant="outline" size="icon" asChild><Link href="/vaults/backup" aria-label={t("backup")} title={t("backup")}><DatabaseBackup aria-hidden="true" /></Link></Button>
        <Button variant="outline" size="icon" asChild><Link href="/vaults/import" aria-label={t("importArchive")} title={t("importArchive")}><Import aria-hidden="true" /></Link></Button>
        <Button size="sm" className="h-11 min-w-0 sm:h-10" asChild><Link href="/vaults/manage/new"><Plus />{t("shared")}</Link></Button>
      </nav>
    </div>
    <ul className="grid list-none gap-2 p-0">
      <li><VaultDirectoryLink href="/vaults/manage/personal" icon={KeyRound} name={t("personalVault")} detail={t("personalOwner")} badge={t("personal")} /></li>
      {vaults.map((vault) => { const memberCanChangeAccounts = Object.values(vault.effectiveAccountPermissions.permissions).some(Boolean); const role = vault.role === "OWNER" ? t("owner") : memberCanChangeAccounts ? t("memberWithPermissions") : t("canView"); return <li key={vault.id}><VaultDirectoryLink href={`/vaults/manage/${encodeURIComponent(vault.id)}`} icon={UsersRound} name={vault.name} detail={t("detail", { count: vault.accounts.length, role })} badge={vault.role === "OWNER" ? t("owner") : t("viewer")} /></li>; })}
    </ul>
  </div>;
}

function VaultDirectoryLink({ href, icon: Icon, name, detail, badge }: { href: string; icon: typeof KeyRound; name: string; detail: string; badge: string }) {
  return <Button variant="outline" className="h-auto min-h-16 w-full justify-start gap-3 p-3 text-left" asChild><Link href={href}><span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground"><Icon /></span><span className="grid min-w-0 flex-1 gap-1"><strong className="truncate text-sm text-foreground">{name}</strong><span className="text-xs font-normal text-muted-foreground">{detail}</span></span><Badge className="bg-muted text-muted-foreground">{badge}</Badge><ChevronRight className="text-muted-foreground" /></Link></Button>;
}

export function SharedVaultDetails({ vault, ownerEmail, initialDefaultAccountPermissions, onRenamed, onAccountDeleted, onDeleted }: { vault: SharedVaultSummary; ownerEmail: string; initialDefaultAccountPermissions?: { permissions: SharedVaultAccountPermissions; revision: number }; onRenamed: (vaultId: string, name: string) => void; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void>; onDeleted?: (vaultId: string) => void }) {
  const t = useTranslations("VaultManagement.details");
  const permissionsT = useTranslations("VaultManagement.permissions");
  const [activeTab, setActiveTab] = useState("details");
  const [status, setStatus] = useState<"renamed" | "renameError" | "deleteError" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [auditFilter, setAuditFilter] = useState<SelectedAuditFilter>({ query: {}, label: "" });
  const renameMutation = useRenameSharedVaultMutation();
  const deleteMutation = useDeleteSharedVaultMutation();
  const defaults = useVaultDefaultAccountPermissionsQuery(vault.id, vault.role === "OWNER" && !initialDefaultAccountPermissions);
  const participants = useVaultParticipantsQuery(vault.id, vault.role === "OWNER" && activeTab === "invitations");
  const participantItems = participants.data?.pages.flatMap((page) => page.participants) ?? [];
  const audit = useVaultAuditQuery(vault.id, auditFilter.query, vault.role === "OWNER" && activeTab === "audit");
  const renameForm = useForm({ defaultValues: { name: vault.name }, onSubmit: async ({ value }) => { try { const name = value.name.trim(); const encryptedName = await encryptSharedVaultName(vault.key, name); await renameMutation.mutateAsync({ vaultId: vault.id, encryptedName: bytesToBase64(encryptedName) }); onRenamed(vault.id, name); setStatus("renamed"); } catch { setStatus("renameError"); } } });
  const defaultPermissionState = initialDefaultAccountPermissions ?? (defaults.data?.vaultDefaultAccountPermissions ? { permissions: defaults.data.vaultDefaultAccountPermissions, revision: defaults.data.vaultDefaultAccountPermissionsRevision } : undefined);

  function openAudit(filter: VaultAuditFilter, label: string) { setAuditFilter({ query: filter, label }); setActiveTab("audit"); }
  async function deleteVault() {
    setStatus(null);
    try {
      await deleteMutation.mutateAsync(vault.id);
      setConfirmingDelete(false);
      onDeleted?.(vault.id);
    } catch {
      setConfirmingDelete(false);
      setStatus("deleteError");
    }
  }

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
          <DeleteSharedVaultSection vaultId={vault.id} onDelete={() => setConfirmingDelete(true)} />
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
        {status && <StatusBanner tone={status === "renamed" ? "success" : "danger"} role={status === "renamed" ? "status" : "alert"}>{t(status)}</StatusBanner>}
      </TabsContent>
      {vault.role === "OWNER" && <TabsContent value="invitations"><InvitationPanel vault={vault} participants={participantItems} loading={participants.isPending} loadingMore={participants.isFetchingNextPage} failed={participants.isError} hasMore={participants.hasNextPage} onLoadMore={() => void participants.fetchNextPage()} onCreated={() => void participants.refetch()} onAudit={(participant) => participant.userId && openAudit({ actorUserId: participant.userId }, participant.email)} /></TabsContent>}
      {vault.role === "OWNER" && <TabsContent value="audit"><VaultAuditHistory audit={audit} accounts={vault.accounts} filter={auditFilter} onClearFilter={() => setAuditFilter({ query: {}, label: "" })} /></TabsContent>}
    </Tabs>
    {confirmingDelete && <ConfirmationDialog title={t("deleteConfirmTitle")} description={t("deleteConfirmDescription")} confirmLabel={t("deleteConfirmAction")} danger pending={deleteMutation.isPending} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void deleteVault()} />}
  </div>;
}

function DeleteSharedVaultSection({ vaultId, onDelete }: { vaultId: string; onDelete: () => void }) {
  const t = useTranslations("VaultManagement.details");
  const [expanded, setExpanded] = useState(false);
  return <Collapsible open={expanded} onOpenChange={setExpanded} className="rounded-md border border-destructive/20 bg-danger-surface/50">
    <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto min-h-11 w-full justify-between gap-3 rounded-b-none p-4 text-left text-destructive whitespace-normal hover:bg-danger-surface hover:text-destructive" type="button" aria-controls={`delete-shared-vault-${vaultId}`}><span className="font-bold">{t("deleteSectionTitle")}</span><ChevronDown className={`size-5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></Button></CollapsibleTrigger>
    <CollapsibleContent id={`delete-shared-vault-${vaultId}`}><div className="grid gap-3 border-t border-destructive/20 p-4"><p className="text-sm text-muted-foreground">{t("deleteSectionDescription")}</p><Button variant="destructive" className="justify-self-end" type="button" onClick={onDelete}><Trash2 />{t("deleteVault")}</Button></div></CollapsibleContent>
  </Collapsible>;
}

function VaultDefaultPermissionsForm({ vaultId, permissions, revision }: { vaultId: string; permissions: SharedVaultAccountPermissions; revision: number }) {
  const t = useTranslations("VaultManagement.permissions");
  const mutation = useUpdateVaultDefaultAccountPermissionsMutation(vaultId);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [expanded, setExpanded] = useState(() => Object.values(permissions).some(Boolean));
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
  return <form noValidate className="rounded-md border bg-muted/30" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto min-h-11 w-full justify-between gap-3 rounded-b-none p-4 text-left whitespace-normal" type="button">
        <span><span className="block font-bold text-foreground">{t("defaultsTitle")}</span><span className="mt-1 block text-sm font-normal text-muted-foreground">{t("defaultsDescription")}</span></span>
        <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </Button></CollapsibleTrigger>
      <CollapsibleContent><div className="grid gap-3 border-t p-4">
        <div className="grid gap-3 sm:grid-cols-3">{permissionFields.map(({ name, label, description }) => <form.Field key={name} name={name}>{(field) => <label className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md bg-card p-3" htmlFor={`vault-default-${name}`}><Checkbox id={`vault-default-${name}`} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} aria-describedby={`vault-default-${name}-description`} /><span><span className="block text-sm font-bold">{t(label)}</span><span id={`vault-default-${name}-description`} className="mt-1 block text-xs leading-4 text-muted-foreground">{t(description)}</span></span></label>}</form.Field>)}</div>
        <Button className="justify-self-end" type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? t("saving") : t("saveDefaults")}</Button>
        {status && <StatusBanner tone={status === "saved" ? "success" : "danger"} role={status === "saved" ? "status" : "alert"}>{t(status)}</StatusBanner>}
      </div></CollapsibleContent>
    </Collapsible>
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
  const [pendingLinks, setPendingLinks] = useState<Record<string, string>>({});
  const [createdInvitations, setCreatedInvitations] = useState<Array<{ id: string; email: string; expiresAt: string }>>([]);
  const [replacedInvitationIds, setReplacedInvitationIds] = useState<string[]>([]);
  const [copiedInvitationId, setCopiedInvitationId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"failed" | "unavailable" | null>(null);
  const [reinvitingInvitationId, setReinvitingInvitationId] = useState<string | null>(null);
  const [latestInvitationLink, setLatestInvitationLink] = useState<string | null>(null);
  const [reinvitationFailed, setReinvitationFailed] = useState(false);
  const deleteMutation = useDeleteVaultParticipantMutation(vault.id);
  const visibleParticipants = participants.filter(({ invitationId }) => !invitationId || !replacedInvitationIds.includes(invitationId));
  const invited = [
    ...visibleParticipants,
    ...createdInvitations.filter(({ id }) => !participants.some((participant) => participant.invitationId === id)).map(({ id, email, expiresAt }) => ({ key: `invitation:${id}`, email, kind: "INVITATION" as const, userId: null, invitationId: id, invitationState: "PENDING" as const, invitedAt: new Date().toISOString(), expiresAt, permissionOverrides: null, effectiveAccountPermissions: null, permissionsRevision: null }))
  ];
  async function removeParticipant() {
    if (!participantToDelete) return;
    await deleteMutation.mutateAsync(participantToDelete);
    const invitationId = participantToDelete.invitationId;
    if (invitationId) {
      setCreatedInvitations((current) => current.filter(({ id }) => id !== invitationId));
      setPendingLinks((current) => { const next = { ...current }; delete next[invitationId]; return next; });
    }
    setParticipantToDelete(null);
  }
  async function copyPendingInvitation(invitationId: string) {
    const link = pendingLinks[invitationId];
    if (!link) {
      setCopyStatus("unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus(null);
      setCopiedInvitationId(invitationId);
    } catch {
      setCopyStatus("failed");
    }
  }
  function rememberInvitation(invitation: { id: string; email: string; expiresAt: string; link: string }, replacedInvitationId?: string) {
    setPendingLinks((current) => { const next = { ...current, [invitation.id]: invitation.link }; if (replacedInvitationId) delete next[replacedInvitationId]; return next; });
    setCreatedInvitations((current) => [...current.filter(({ id }) => id !== invitation.id && id !== replacedInvitationId), { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt }]);
    if (replacedInvitationId) setReplacedInvitationIds((current) => [...current, replacedInvitationId]);
    setLatestInvitationLink(invitation.link);
    onCreated();
  }
  async function reinvite(participant: BrowserVaultParticipant) {
    if (!participant.invitationId || participant.invitationState !== "EXPIRED") return;
    setReinvitingInvitationId(participant.invitationId);
    setReinvitationFailed(false);
    try {
      const invitation = await createSharedVaultInvitation(vault.id, participant.email, vault.key);
      const link = `${window.location.origin}/vaults/invitations/redeem#${invitation.secret}`;
      rememberInvitation({ id: invitation.id, email: participant.email, expiresAt: invitation.expiresAt, link }, participant.invitationId);
    } catch { setReinvitationFailed(true); }
    finally { setReinvitingInvitationId(null); }
  }
  return <div className="grid gap-5">
    <InvitationForm vault={vault} onCreated={(invitation) => rememberInvitation(invitation)} />
    {latestInvitationLink && <SecureInvitationLink link={latestInvitationLink} />}
    <section className="grid gap-3" aria-labelledby="invited-users-title">
      <div><h3 id="invited-users-title" className="font-bold text-ink-strong">{t("usersTitle")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("usersDescription")}</p></div>
      {loading && <SectionLoadingPlaceholder rows={2} label={t("loading")} />}
      {failed && <StatusBanner tone="danger" role="alert">{t(invited.length ? "nextError" : "listError")}</StatusBanner>}
      {!loading && !failed && !invited.length && <p className="rounded-md border border-dashed bg-muted/30 p-5 text-center text-sm text-muted-foreground">{t("empty")}</p>}
      {!!invited.length && <ul className="grid list-none gap-2 p-0">{invited.map((participant) => {
        const invitationId = participant.kind === "INVITATION" ? participant.invitationId : null;
        const expired = participant.invitationState === "EXPIRED";
        const linkAvailable = invitationId ? Boolean(pendingLinks[invitationId]) : false;
        return <li key={participant.key} className="grid items-center gap-3 rounded-md border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><span className="grid min-w-0 gap-1"><strong className="break-all text-sm sm:truncate">{participant.email}</strong><span className="flex flex-wrap items-center gap-2"><Badge className={expired ? "w-fit bg-danger-surface text-destructive" : "w-fit bg-muted text-muted-foreground"}>{participant.kind === "MEMBER" ? t("active") : expired ? t("expired") : t("pending")}</Badge>{participant.effectiveAccountPermissions && <span className="text-xs text-muted-foreground"><PermissionSummary permissions={participant.effectiveAccountPermissions.permissions} /></span>}</span></span><span className="flex flex-wrap items-center justify-end gap-1">{expired && <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" type="button" disabled={reinvitingInvitationId === invitationId} aria-busy={reinvitingInvitationId === invitationId} onClick={() => void reinvite(participant)}><RefreshCw className={reinvitingInvitationId === invitationId ? "animate-spin" : undefined} />{reinvitingInvitationId === invitationId ? t("reinviting") : t("reinvite")}</Button>}{invitationId && !expired && <Button variant="ghost" size="icon" type="button" aria-label={t(linkAvailable ? "copyPending" : "copyUnavailableLabel", { email: participant.email })} title={linkAvailable ? copiedInvitationId === invitationId ? t("pendingCopied") : t("copy") : t("copyUnavailableTitle")} onClick={() => void copyPendingInvitation(invitationId)}>{linkAvailable ? copiedInvitationId === invitationId ? <Check /> : <Clipboard /> : <ClipboardX />}</Button>}{participant.kind === "MEMBER" && <Button variant="ghost" size="icon" type="button" aria-label={t("configurePermissions", { email: participant.email })} onClick={() => setParticipantToConfigure(participant)}><Settings2 /></Button>}<Button variant="ghost" size="icon" type="button" aria-label={t("viewAudit", { email: participant.email })} title={participant.userId ? t("viewAuditTitle") : t("auditUnavailable")} disabled={!participant.userId} onClick={() => onAudit(participant)}><ScrollText /></Button><Button variant="ghost" size="icon" className="text-destructive hover:bg-danger-surface hover:text-destructive" type="button" aria-label={t("deleteLabel", { email: participant.email })} onClick={() => setParticipantToDelete(participant)}><Trash2 /></Button></span></li>;
      })}</ul>}
      {reinvitationFailed && <StatusBanner tone="danger" role="alert">{t("reinviteError")}</StatusBanner>}
      {copyStatus && <StatusBanner tone={copyStatus === "failed" ? "danger" : "warning"} role={copyStatus === "failed" ? "alert" : "status"}>{t(copyStatus === "failed" ? "copyError" : "copyUnavailable")}</StatusBanner>}
      {hasMore && <Button variant="outline" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? t("loading") : t("loadMore")}</Button>}
      {!!invited.length && !hasMore && <p className="text-center text-xs text-muted-foreground" aria-live="polite">{t("allLoaded")}</p>}
    </section>
    {participantToDelete && <ConfirmationDialog title={participantToDelete.kind === "MEMBER" ? t("revokeTitle") : t("deleteTitle")} description={participantToDelete.kind === "MEMBER" ? t("revokeDescription", { email: participantToDelete.email }) : t("deleteDescription", { email: participantToDelete.email })} confirmLabel={participantToDelete.kind === "MEMBER" ? t("revoke") : t("delete")} danger pending={deleteMutation.isPending} onCancel={() => setParticipantToDelete(null)} onConfirm={() => void removeParticipant()} />}
    {participantToConfigure?.userId && participantToConfigure.permissionOverrides && participantToConfigure.effectiveAccountPermissions && participantToConfigure.permissionsRevision && <MemberPermissionsDialog key={`${participantToConfigure.userId}:${participantToConfigure.permissionsRevision}`} vaultId={vault.id} participant={participantToConfigure} onClose={() => setParticipantToConfigure(null)} />}
  </div>;
}

function InvitationForm({ vault, onCreated }: { vault: SharedVaultSummary; onCreated: (invitation: { id: string; email: string; expiresAt: string; link: string }) => void }) {
  const t = useTranslations("VaultManagement.invitations");
  const [error, setError] = useState(false);
  const form = useForm({ defaultValues: { email: "" }, onSubmit: async ({ value }) => { setError(false); try { const email = value.email.trim().toLowerCase(); const invitation = await createSharedVaultInvitation(vault.id, email, vault.key); const link = `${window.location.origin}/vaults/invitations/redeem#${invitation.secret}`; form.reset(); onCreated({ id: invitation.id, email, expiresAt: invitation.expiresAt, link }); } catch { setError(true); } } });
  return <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <div><h3 className="flex items-center gap-2 font-bold text-ink-strong"><MailPlus className="size-5" />{t("formTitle")}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("formDescription")}</p></div>
    <form.Field name="email" validators={{ onSubmit: ({ value }) => /^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : t("invalidEmail") }}>{(field) => <div className="grid gap-2"><Label htmlFor="invitation-email">{t("recipientEmail")}</Label><Input id="invitation-email" type="email" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="email" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "invitation-email-error" : undefined} required /><FormFieldError id="invitation-email-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button className="w-full sm:w-auto sm:justify-self-end" type="submit" disabled={pending}>{pending ? t("creating") : t("create")}</Button>}</form.Subscribe>
    {error && <StatusBanner tone="danger" role="alert">{t("createError")}</StatusBanner>}
  </form>;
}

function SecureInvitationLink({ link }: { link: string }) {
  const t = useTranslations("VaultManagement.invitations");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyLink() { try { await navigator.clipboard.writeText(link); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }
  return <div className="grid min-w-0 gap-2 rounded-md border border-success/20 bg-success-surface p-3"><p className="text-sm font-bold text-success">{t("ready")}</p><output className="min-w-0 break-all rounded-sm bg-card p-2 font-mono text-xs" aria-label={t("secureLink")}>{link}</output><Button className="w-full sm:w-auto sm:justify-self-end" variant="outline" type="button" onClick={() => void copyLink()}>{copied ? <Check /> : <Clipboard />}{copied ? t("copied") : t("copy")}</Button>{copyFailed && <StatusBanner tone="danger" role="alert">{t("copyError")}</StatusBanner>}</div>;
}

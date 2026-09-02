"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Clipboard, ClipboardX, MailPlus, RefreshCw, ScrollText, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { browserClipboard } from "@/shared/infrastructure/browser-platform-ports";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { FormLoadingPlaceholder, SectionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";
import type { EffectiveSharedVaultAccountPermissions, SharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core";
import { createSharedVaultInvitation } from "../infrastructure/browser-shared-vault-invitation";
import type { BrowserVaultParticipant } from "../infrastructure/browser-vault-participant-client";
import {
  useDeleteVaultParticipantMutation,
  useUpdateVaultDefaultAccountPermissionsMutation,
  useUpdateVaultMemberAccountPermissionOverridesMutation,
  useVaultDefaultAccountPermissionsQuery,
  useVaultParticipantsQuery
} from "./hooks/use-vault-participants";

type MembershipVault = { id: string; key: Uint8Array };

export function VaultMembershipDefaults({ vaultId, initial }: {
  vaultId: string;
  initial?: { permissions: SharedVaultAccountPermissions; revision: number };
}) {
  const t = useTranslations("VaultManagement.permissions");
  const defaults = useVaultDefaultAccountPermissionsQuery(vaultId, !initial);
  const state = initial ?? (defaults.data?.vaultDefaultAccountPermissions
    ? { permissions: defaults.data.vaultDefaultAccountPermissions, revision: defaults.data.vaultDefaultAccountPermissionsRevision }
    : undefined);
  if (defaults.isPending && !initial) return <FormLoadingPlaceholder />;
  if (defaults.isError && !initial) return <StatusBanner tone="danger" role="alert">{t("loadingError")}</StatusBanner>;
  return state ? <VaultDefaultPermissionsForm key={state.revision} vaultId={vaultId} permissions={state.permissions} revision={state.revision} /> : null;
}

export function VaultMembershipOwnerPanel({ vault, active, onAudit }: {
  vault: MembershipVault;
  active: boolean;
  onAudit: (participant: BrowserVaultParticipant) => void;
}) {
  const participants = useVaultParticipantsQuery(vault.id, active);
  const participantItems = participants.data?.pages.flatMap((page) => page.participants) ?? [];
  return <InvitationPanel
    vault={vault}
    participants={participantItems}
    loading={participants.isPending}
    loadingMore={participants.isFetchingNextPage}
    failed={participants.isError}
    hasMore={participants.hasNextPage}
    onLoadMore={() => void participants.fetchNextPage()}
    onCreated={() => void participants.refetch()}
    onAudit={onAudit}
  />;
}

export function VaultMemberPermissionNotice({ effective }: { effective: EffectiveSharedVaultAccountPermissions }) {
  const t = useTranslations("VaultManagement.permissions");
  return <StatusBanner tone="info" title={t("yourTitle")}><span>{t("yourDescription")}</span><span className="mt-2 block"><PermissionSummary permissions={effective.permissions} /></span></StatusBanner>;
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
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultDefaultPermissionsUpdated);
        setStatus("saved");
      } catch {
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, { operation: "update_default_permissions", failure_code: "unknown" });
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
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultMemberPermissionsUpdated);
        onClose();
      } catch {
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, { operation: "update_permissions", failure_code: "unknown" });
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

function InvitationPanel({ vault, participants, loading, loadingMore, failed, hasMore, onLoadMore, onCreated, onAudit }: { vault: MembershipVault; participants: BrowserVaultParticipant[]; loading: boolean; loadingMore: boolean; failed: boolean; hasMore: boolean; onLoadMore: () => void; onCreated: () => void; onAudit: (participant: BrowserVaultParticipant) => void }) {
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
    const participantType = participantToDelete.kind === "MEMBER" ? "member" : "invitation";
    try {
      await deleteMutation.mutateAsync(participantToDelete);
      captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultParticipantRemoved, { participant_type: participantType });
      const invitationId = participantToDelete.invitationId;
      if (invitationId) {
        setCreatedInvitations((current) => current.filter(({ id }) => id !== invitationId));
        setPendingLinks((current) => { const next = { ...current }; delete next[invitationId]; return next; });
      }
      setParticipantToDelete(null);
    } catch (error) {
      captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, { operation: "remove_participant", failure_code: "unknown" });
      throw error;
    }
  }
  async function copyPendingInvitation(invitationId: string) {
    const link = pendingLinks[invitationId];
    if (!link) {
      setCopyStatus("unavailable");
      return;
    }
    try {
      await browserClipboard.writeText(link);
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
      captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultInvitationReissued);
      rememberInvitation({ id: invitation.id, email: participant.email, expiresAt: invitation.expiresAt, link }, participant.invitationId);
    } catch { captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, { operation: "reinvite", failure_code: "unknown" }); setReinvitationFailed(true); }
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

function InvitationForm({ vault, onCreated }: { vault: MembershipVault; onCreated: (invitation: { id: string; email: string; expiresAt: string; link: string }) => void }) {
  const t = useTranslations("VaultManagement.invitations");
  const [error, setError] = useState(false);
  const form = useForm({ defaultValues: { email: "" }, onSubmit: async ({ value }) => { setError(false); try { const email = value.email.trim().toLowerCase(); const invitation = await createSharedVaultInvitation(vault.id, email, vault.key); const link = `${window.location.origin}/vaults/invitations/redeem#${invitation.secret}`; captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultInvitationCreated); form.reset(); onCreated({ id: invitation.id, email, expiresAt: invitation.expiresAt, link }); } catch { captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultOperationFailed, { operation: "invite", failure_code: "unknown" }); setError(true); } } });
  return <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <div><h3 className="flex items-center gap-2 font-bold text-ink-strong"><MailPlus className="size-5" />{t("formTitle")}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("formDescription")}</p></div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <form.Field name="email" validators={{ onSubmit: ({ value }) => /^\S+@\S+\.\S+$/.test(value.trim()) ? undefined : t("invalidEmail") }}>{(field) => <div className="grid gap-2"><Label htmlFor="invitation-email">{t("recipientEmail")}</Label><Input id="invitation-email" type="email" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="email" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "invitation-email-error" : undefined} required /><FormFieldError id="invitation-email-error" errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button className="w-full sm:w-auto" type="submit" disabled={pending}>{pending ? t("creating") : t("create")}</Button>}</form.Subscribe>
    </div>
    {error && <StatusBanner tone="danger" role="alert">{t("createError")}</StatusBanner>}
  </form>;
}

function SecureInvitationLink({ link }: { link: string }) {
  const t = useTranslations("VaultManagement.invitations");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyLink() { try { await browserClipboard.writeText(link); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }
  return <div className="grid min-w-0 gap-2 rounded-md border border-success/20 bg-success-surface p-3"><p className="text-sm font-bold text-success">{t("ready")}</p><output className="min-w-0 break-all rounded-sm bg-card p-2 font-mono text-xs" aria-label={t("secureLink")}>{link}</output><Button className="w-full sm:w-auto sm:justify-self-end" variant="outline" type="button" onClick={() => void copyLink()}>{copied ? <Check /> : <Clipboard />}{copied ? t("copied") : t("copy")}</Button>{copyFailed && <StatusBanner tone="danger" role="alert">{t("copyError")}</StatusBanner>}</div>;
}

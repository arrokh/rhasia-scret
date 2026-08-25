"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "@tanstack/react-form";
import { useLocale, useTranslations } from "next-intl";
import { Fingerprint, KeyRound, Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  loadOfflineVaultWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser,
  type UnlockedVaultWorkspace
} from "../infrastructure/browser-vault-workspace";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { AppPage, Brand, PageHeader, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { formatLocalDateTime } from "@/i18n/format";
import { PasswordInput } from "@/shared/presentation/password-input";
import { BrowserOfflineVaultRepository } from "../infrastructure/browser-offline-vault-repository";
import { VaultStatusIndicator } from "./vault-status-indicator";
import { useWorkspaceLifecycle } from "./use-workspace-lifecycle";
import type { OfflineProfileSummary } from "../infrastructure/browser-offline-vault-repository";

export function OfflineVaultShell() {
  const t = useTranslations("Sync.offline");
  const locale = useLocale();
  const [profiles, setProfiles] = useState<OfflineProfileSummary[]>([]);
  const { workspace, replaceWorkspace } = useWorkspaceLifecycle();
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "unlock_error" | "remembered_error" | "storage_error">("loading");
  const [secretVisible, setSecretVisible] = useState(false);
  const [repository] = useState(() => new BrowserOfflineVaultRepository());
  const form = useForm({
    defaultValues: { profileId: "", secret: "" },
    onSubmit: async ({ value }) => {
      setStatus("ready");
      try {
        replaceWorkspace(await loadOfflineVaultWorkspace(value.profileId, value.secret));
        form.setFieldValue("secret", "");
      } catch { setStatus("unlock_error"); }
    }
  });

  useEffect(() => {
    let active = true;
    repository.listProfiles().then((items) => {
      if (!active) return;
      setProfiles(items);
      if (items[0]) form.setFieldValue("profileId", items[0].profileId);
      setStatus(items.length ? "ready" : "empty");
    }).catch(() => { if (active) setStatus("storage_error"); });
    return () => { active = false; };
  }, [form, repository]);

  async function unlockRemembered() {
    const profileId = form.state.values.profileId;
    if (!profileId) return;
    setStatus("ready");
    try { replaceWorkspace(await loadOfflineVaultWorkspaceWithRememberedBrowser(profileId)); }
    catch { setStatus("remembered_error"); }
  }

  async function clearDevice() {
    replaceWorkspace(null);
    try { await repository.clearAll(); setProfiles([]); setStatus("empty"); }
    catch { setStatus("storage_error"); }
  }

  if (workspace) return <UnlockedOfflineWorkspace workspace={workspace} onLock={() => replaceWorkspace(null)} onClear={() => void clearDevice()} />;

  return <AppPage>
    <PageHeader title={t("title")} description={t("description")} action={<Brand compact />} />
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <VaultStatusIndicator origin="SNAPSHOT" syncState="OFFLINE" />
      <StatusBanner tone="offline" title={t("readOnly")}>{t("readOnlyDescription")}</StatusBanner>
      {status === "loading" && <p className="text-sm text-muted-foreground">{t("searching")}</p>}
      {status === "empty" && <StatusBanner tone="warning">{t("empty")}</StatusBanner>}
      {profiles.length > 0 && <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
        <form.Field name="profileId">{(field) => <div className="grid gap-2"><Label htmlFor="offline-profile">{t("profile")}</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="offline-profile" className="w-full"><SelectValue placeholder={t("chooseSnapshot")} /></SelectTrigger><SelectContent>{profiles.map((profile, index) => <SelectItem key={profile.profileId} value={profile.profileId}>{t("profileSummary", { number: index + 1, date: formatLocalDateTime(profile.synchronizedAt, locale), count: profile.sharedVaultCount + 1 })}</SelectItem>)}</SelectContent></Select></div>}</form.Field>
        <form.Field name="secret" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("passphraseRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="offline-secret">{t("passphrase")}</Label><PasswordInput id="offline-secret" label={t("passphrase")} visible={secretVisible} onToggleVisibility={() => setSecretVisible((value) => !value)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "offline-secret-error" : undefined} autoComplete="current-password" required /><FormFieldError id="offline-secret-error" errors={field.state.meta.errors} /></div>}</form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={pending} aria-busy={pending}><KeyRound />{pending ? t("unlocking") : t("unlockPassphrase")}</Button>}</form.Subscribe>
        <Button type="button" variant="outline" onClick={() => void unlockRemembered()}><Fingerprint />{t("unlockLocal")}</Button>
      </form>}
      {status === "unlock_error" && <StatusBanner tone="danger" role="alert">{t("unlockError")}</StatusBanner>}
      {status === "remembered_error" && <StatusBanner tone="warning">{t("rememberedError")}</StatusBanner>}
      {status === "storage_error" && <StatusBanner tone="danger" role="alert">{t("storageError")}</StatusBanner>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/sign-in">{t("backSignIn")}</Link></Button>{profiles.length > 0 && <Button type="button" variant="ghost" className="text-destructive" onClick={() => void clearDevice()}><Trash2 />{t("clearDevice")}</Button>}</div>
    </SurfaceCard>
  </AppPage>;
}

function UnlockedOfflineWorkspace({ workspace, onLock, onClear }: { workspace: UnlockedVaultWorkspace; onLock: () => void; onClear: () => void }) {
  const t = useTranslations("Sync.offline");
  const locale = useLocale();
  const snapshotDate = formatLocalDateTime(workspace.synchronizedAt, locale);
  return <AppPage>
    <PageHeader title={t("accountsTitle")} description={t("snapshotDate", { date: snapshotDate })} action={<Button variant="outline" onClick={onLock}><Lock />{t("lock")}</Button>} />
    <SurfaceCard className="grid gap-5 p-4 sm:p-5">
      <VaultStatusIndicator origin="SNAPSHOT" syncState={workspace.syncState} lastSynchronizedAt={workspace.synchronizedAt} />
      {workspace.syncState === "CURRENT" ? <p className="text-sm text-muted-foreground">{t("syncComplete")} <Link href="/vaults" className="font-bold underline">{t("continueOnline")}</Link>.</p> : <p className="text-sm text-muted-foreground">{t("staleDescription")}</p>}
      {workspace.unavailableSharedVaults > 0 && <StatusBanner tone="danger">{t("unavailableVaults", { count: workspace.unavailableSharedVaults })}</StatusBanner>}
      <ul className="grid list-none gap-3 p-0">{workspace.accounts.map((account) => <li key={`${account.vaultId}:${account.id}`}><TotpAccountButton configuration={account} vaultName={account.vaultName} /></li>)}</ul>
      {!workspace.accounts.length && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("emptyAccounts")}</p>}
      <Button type="button" variant="ghost" className="justify-self-start text-destructive" onClick={onClear}><Trash2 />{t("clearSnapshot")}</Button>
    </SurfaceCard>
  </AppPage>;
}


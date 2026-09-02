"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Download, KeyRound, LockKeyhole, Plus, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { AppPage, PageHeader, SectionHeading, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { parseTotpUri, TotpConfigurationError, type TotpConfiguration, type TotpConfigurationErrorCode } from "@/modules/otp-runtime";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { VaultStatusIndicator } from "@/modules/sync";
import { QrImportInput } from "@/modules/authenticator-account";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import {
  addLocalAccount,
  clearLocalVault,
  clearUnlockedLocalVault,
  createLocalVault,
  deleteLocalAccount,
  exportLocalVault,
  importLocalVaultArchive,
  LocalVaultMigrationRequiredError,
  migrateLegacyLocalVault,
  previewLocalVaultArchive,
  readLocalVaultRecord,
  refreshUnlockedLocalVault,
  renameLocalVault,
  unlockLocalVault,
  updateLocalAccount,
  type UnlockedLocalVault,
  type UnlockedLocalVaultAccount
} from "@/modules/local-vault";
import { BrowserLocalVaultRepository, browserLocalVaultCapabilities } from "../infrastructure/browser-local-vault-repository";
import { browserDownload } from "@/shared/infrastructure/browser-platform-ports";
import type { LocalVaultRecord } from "../domain/local-vault-record";

export function LocalVaultPage({ backHref = "/sign-in" }: { backHref?: string } = {}) {
  const t = useTranslations("LocalVault");
  const [record, setRecord] = useState<LocalVaultRecord | null>(null);
  const [vault, setVault] = useState<UnlockedLocalVault | null>(null);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success" | "warning"; text: string } | null>(null);
  const [legacyMigration, setLegacyMigration] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [editing, setEditing] = useState<UnlockedLocalVaultAccount | null>(null);
  const vaultRef = useRef<UnlockedLocalVault | null>(null);
  useEffect(() => { vaultRef.current = vault; }, [vault]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!browserLocalVaultCapabilities.isAvailable()) {
        if (active) {
          setUnsupported(true);
          setLoading(false);
        }
        return;
      }
      try {
        const stored = await readLocalVaultRecord();
        if (active) setRecord(stored);
      } catch {
        if (active) setMessage({ tone: "danger", text: t("storageError") });
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [t]);

  useEffect(() => () => clearUnlockedLocalVault(vaultRef.current), []);

  function lock() {
    clearUnlockedLocalVault(vault);
    setVault(null);
    setEditing(null);
    setMessage(null);
    captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultLocked);
  }

  async function create(passphrase: string, name: string) {
    setMessage(null);
    let unlocked: UnlockedLocalVault | undefined;
    try {
      const created = await createLocalVault(passphrase, name);
      unlocked = await unlockLocalVault(created, passphrase);
      await new BrowserLocalVaultRepository().create(created);
      setRecord(created);
      setVault(unlocked);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultCreated);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultUnlocked, { method: "passphrase" });
    } catch {
      clearUnlockedLocalVault(unlocked ?? null);
      setMessage({ tone: "danger", text: t("storageError") });
    }
  }

  async function unlock(passphrase: string) {
    if (!record) return;
    setMessage(null);
    try {
      const unlocked = await unlockLocalVault(record, passphrase);
      setVault(unlocked);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultUnlocked, { method: "passphrase" });
    } catch (error) {
      setLegacyMigration(error instanceof LocalVaultMigrationRequiredError);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultUnlockFailed, { method: "passphrase", failure_code: error instanceof LocalVaultMigrationRequiredError ? "migration_required" : "unknown" });
      setMessage({ tone: "danger", text: error instanceof LocalVaultMigrationRequiredError ? t("migrationRequired") : t("unlockError") });
    }
  }

  async function migrate(passphrase: string) {
    setMessage(null);
    try {
      const migrated = await migrateLegacyLocalVault(passphrase);
      const unlocked = await unlockLocalVault(migrated, passphrase);
      setRecord(migrated);
      setVault(unlocked);
      setLegacyMigration(false);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultMigrated);
    } catch {
      setMessage({ tone: "danger", text: t("unlockError") });
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await clearLocalVault();
      clearUnlockedLocalVault(vault);
      setVault(null);
      setRecord(null);
      setClearOpen(false);
      setMessage({ tone: "success", text: t("clear") });
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultCleared);
    } catch {
      setMessage({ tone: "danger", text: t("storageError") });
    } finally {
      setClearing(false);
    }
  }

  if (loading) return <AppPage><PageHeader title={t("title")} /><SurfaceCard className="p-6"><p role="status">{t("loading")}</p></SurfaceCard></AppPage>;
  if (unsupported) return <AppPage><PageHeader title={t("title")} /><SurfaceCard className="p-6"><StatusBanner tone="danger" role="alert">{t("unsupported")}</StatusBanner></SurfaceCard></AppPage>;

  return <AppPage>
    <PageHeader title={t("title")} description={t("description")} backHref={backHref} />
    {message && <div className="mb-5"><StatusBanner tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</StatusBanner></div>}
    <VaultStatusIndicator origin="LOCAL" className="mb-5" />
    {!record && <SurfaceCard className="grid gap-5 p-5 sm:p-6"><CreateLocalVaultForm onCreate={create} /></SurfaceCard>}
    {record && !vault && <SurfaceCard className="grid gap-5 p-5 sm:p-6"><UnlockLocalVaultForm onUnlock={unlock} onMigrate={legacyMigration ? migrate : undefined} /></SurfaceCard>}
    {record && vault && <UnlockedLocalVaultView vault={vault} onLock={lock} onClear={() => setClearOpen(true)} onRename={async (name) => { await renameLocalVault(vault, name); captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultRenamed); setVault({ ...vault }); void readLocalVaultRecord().then(setRecord); }} onChanged={(next) => { setVault(next); void readLocalVaultRecord().then(setRecord); }} onEdit={setEditing} onError={(text) => setMessage({ tone: "danger", text })} />}
    {clearOpen && <ConfirmationDialog title={t("clearTitle")} description={t("clearDescription")} confirmLabel={t("clearConfirm")} danger pending={clearing} onCancel={() => setClearOpen(false)} onConfirm={() => void handleClear()} />}
    {vault && editing && <LocalAccountEditor account={editing} onCancel={() => setEditing(null)} onDelete={async () => { await deleteLocalAccount(vault, editing.id); captureAnalyticsEvent(ANALYTICS_EVENTS.localAuthenticatorAccountDeleted); setEditing(null); setVault({ ...vault, accounts: [...vault.accounts] }); }} onSave={async (configuration) => { await updateLocalAccount(vault, editing.id, configuration); captureAnalyticsEvent(ANALYTICS_EVENTS.localAuthenticatorAccountUpdated); setEditing(null); setVault({ ...vault, accounts: [...vault.accounts] }); }} onError={(text) => setMessage({ tone: "danger", text })} />}
  </AppPage>;
}

function CreateLocalVaultForm({ onCreate }: { onCreate: (passphrase: string, name: string) => Promise<void> }) {
  const t = useTranslations("LocalVault");
  const [visible, setVisible] = useState(false);
  const form = useForm({ defaultValues: { name: "", passphrase: "", confirmation: "" }, onSubmit: async ({ value }) => onCreate(value.passphrase, value.name) });
  return <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
    <SectionHeading icon={ShieldCheck} title={t("createTitle")} description={t("createDescription")} />
    <form.Field name="name" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("nameRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-vault-name">{t("name")}</Label><Input id="local-vault-name" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-vault-name-help local-vault-name-error" required /><p id="local-vault-name-help" className="text-xs leading-5 text-muted-foreground">{t("nameHelp")}</p><FormFieldError id="local-vault-name-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Field name="passphrase" validators={{ onSubmit: ({ value }) => value.trim().length >= 3 ? undefined : t("passphraseRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-vault-passphrase">{t("passphrase")}</Label><PasswordInput id="local-vault-passphrase" label={t("passphrase")} visible={visible} onToggleVisibility={() => setVisible((current) => !current)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-vault-passphrase-help local-vault-passphrase-error" required /><p id="local-vault-passphrase-help" className="text-xs leading-5 text-muted-foreground">{t("passphraseHelp")}</p><FormFieldError id="local-vault-passphrase-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Field name="confirmation" validators={{ onSubmit: ({ value }) => value === form.state.values.passphrase ? undefined : t("passphraseMismatch") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-vault-passphrase-confirm">{t("passphraseConfirm")}</Label><PasswordInput id="local-vault-passphrase-confirm" label={t("passphraseConfirm")} visible={visible} onToggleVisibility={() => setVisible((current) => !current)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-vault-passphrase-confirm-error" required /><FormFieldError id="local-vault-passphrase-confirm-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? t("creating") : t("create")}</Button>}</form.Subscribe>
  </form>;
}

function UnlockLocalVaultForm({ onUnlock, onMigrate }: { onUnlock: (passphrase: string) => Promise<void>; onMigrate?: (passphrase: string) => Promise<void> }) {
  const t = useTranslations("LocalVault");
  const [visible, setVisible] = useState(false);
  const form = useForm({ defaultValues: { passphrase: "" }, onSubmit: async ({ value }) => onUnlock(value.passphrase) });
  return <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
    <SectionHeading icon={LockKeyhole} title={t("unlockTitle")} description={t("unlockDescription")} />
    <form.Field name="passphrase" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("passphraseRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-vault-unlock">{t("passphrase")}</Label><PasswordInput id="local-vault-unlock" label={t("passphrase")} visible={visible} onToggleVisibility={() => setVisible((current) => !current)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-vault-unlock-error" required /><FormFieldError id="local-vault-unlock-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <><Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? t("unlocking") : t("unlock")}</Button>{onMigrate && <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => void onMigrate(form.state.values.passphrase)}>{t("migrate")}</Button>}</>}</form.Subscribe>
  </form>;
}

function UnlockedLocalVaultView({ vault, onLock, onClear, onRename, onChanged, onEdit, onError }: { vault: UnlockedLocalVault; onLock: () => void; onClear: () => void; onRename: (name: string) => Promise<void>; onChanged: (vault: UnlockedLocalVault) => void; onEdit: (account: UnlockedLocalVaultAccount) => void; onError: (message: string) => void }) {
  const t = useTranslations("LocalVault");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState("vault");
  async function add(configuration: TotpConfiguration): Promise<boolean> {
    try {
      await addLocalAccount(vault, configuration);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localAuthenticatorAccountCreated);
      onChanged({ ...vault, accounts: [...vault.accounts] });
      setActiveTab("vault");
      return true;
    } catch {
      configuration.secret.fill(0);
      onError(t("duplicate"));
      return false;
    }
  }
  async function backup() {
    setExporting(true);
    try {
      const result = await exportLocalVault(vault);
      download(result.archive, "local-vault.rhasia-vault");
      download(new TextEncoder().encode(bytesToBase64(result.key)), "local-vault.key.txt", "text/plain");
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultArchiveExportPrepared, { account_count: vault.accounts.length });
      result.key.fill(0);
    } catch { onError(t("backupError")); }
    finally { setExporting(false); }
  }
  return <SurfaceCard className="p-0">
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="mx-5 mt-5 grid-cols-4 sm:mx-6 sm:mt-6">
        <TabsTrigger value="vault">{vault.name}</TabsTrigger>
        <TabsTrigger value="add">{t("addTab")}</TabsTrigger>
        <TabsTrigger value="backup">{t("backupTab")}</TabsTrigger>
        <TabsTrigger value="advanced" aria-label={t("advancedTab")} title={t("advancedTab")}>{t("advancedTab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="vault" className="mt-0">
        <div className="grid gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{t("deviceOnly")}</p><h2 className="mt-1 text-xl font-bold text-ink-strong">{vault.name}</h2><p className="mt-1 text-sm text-muted-foreground">{t("offline")}</p></div><Button type="button" onClick={() => setActiveTab("add")}><Plus aria-hidden="true" />{t("addTab")}</Button></div>
        </div>
        <div className="border-t border-border">{vault.accounts.length ? <ul className="grid list-none gap-3 p-5 sm:p-6">{vault.accounts.map((account) => <li key={account.id}><TotpAccountButton configuration={account} vaultName={vault.name} onManage={() => onEdit(account)} /></li>)}</ul> : <div className="grid justify-items-center gap-3 p-6 text-center"><p className="text-sm text-muted-foreground">{t("empty")}</p><Button type="button" onClick={() => setActiveTab("add")}>{t("addTitle")}</Button></div>}</div>
      </TabsContent>
      <TabsContent value="add" className="mt-0"><AddLocalAccountForm onAdd={add} /></TabsContent>
      <TabsContent value="backup" className="mt-0 p-5 sm:p-6">
        <div className="mb-4"><h2 className="font-bold text-ink-strong">{t("backupTitle")}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("backupDescription")}</p></div>
        <div className="grid gap-4"><section className="grid gap-3 rounded-md border border-border p-4"><h3 className="font-bold text-ink-strong">{t("export")}</h3><p className="text-sm leading-5 text-muted-foreground">{t("exportDescription")}</p><div className="flex justify-end"><Button variant="outline" className="w-full sm:w-fit" onClick={() => void backup()} disabled={exporting}><Download />{exporting ? t("exporting") : t("export")}</Button></div></section><LocalArchiveImporter vault={vault} onImported={() => void reloadLocalVault(vault, onChanged)} onError={onError} importing={importing} setImporting={setImporting} /></div>
      </TabsContent>
      <TabsContent value="advanced" className="mt-0 p-5 sm:p-6"><LocalVaultSettings vault={vault} onLock={onLock} onClear={onClear} onRename={onRename} onError={onError} /></TabsContent>
    </Tabs>
  </SurfaceCard>;
}

export function AddLocalAccountForm({ onAdd }: { onAdd: (configuration: TotpConfiguration) => Promise<boolean> }) {
  const t = useTranslations("LocalVault");
  const tError = useTranslations("OtpRuntime.errors");
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const [parseError, setParseError] = useState<TotpConfigurationErrorCode | null>(null);
  const form = useForm({ defaultValues: { uri: "", label: "" }, onSubmit: async ({ value }) => {
    if (!configuration) return;
    if (await onAdd({ ...configuration, accountName: value.label.trim() })) {
      configuration.secret.fill(0);
      setConfiguration(null);
      form.reset();
    }
  } });
  function importUri(uri: string) {
    try {
      const parsed = parseTotpUri(uri);
      setConfiguration((current) => { current?.secret.fill(0); return parsed; });
      setParseError(null);
      form.setFieldValue("uri", uri);
      form.setFieldValue("label", parsed.accountName);
    } catch (reason) {
      setConfiguration((current) => { current?.secret.fill(0); return null; });
      setParseError(reason instanceof TotpConfigurationError ? reason.code : "invalidUri");
    }
  }
  return <div className="grid gap-5 p-5 sm:p-6">{configuration ? <form noValidate className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-ink-strong">{t("reviewTitle")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("reviewDescription")}</p></div><Button type="button" variant="ghost" size="sm" onClick={() => { configuration.secret.fill(0); setConfiguration(null); form.reset(); }}>{t("importAnother")}</Button></div><form.Field name="label" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("labelRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-account-label">{t("label")}</Label><Input id="local-account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-account-label-error" required /><FormFieldError id="local-account-label-error" errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : t("save")}</Button>}</form.Subscribe></form> : <><QrImportInput onUri={importUri} className="p-0 sm:p-0" />{parseError && <StatusBanner tone="danger" role="alert">{tError(parseError)}</StatusBanner>}</>}</div>;
}

function LocalAccountEditor({ account, onCancel, onDelete, onSave, onError }: { account: UnlockedLocalVaultAccount; onCancel: () => void; onDelete: () => Promise<void>; onSave: (configuration: TotpConfiguration) => Promise<void>; onError: (message: string) => void }) {
  const t = useTranslations("LocalVault");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const form = useForm({ defaultValues: { label: account.accountName }, onSubmit: async ({ value }) => onSave({ ...account, accountName: value.label.trim() }) });
  async function remove() {
    setDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch {
      onError(t("operationError"));
    } finally {
      setDeleting(false);
    }
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}><DialogContent className="max-w-md rounded-lg border-border bg-card p-5 shadow-sheet"><DialogTitle className="sr-only">{t("edit")}</DialogTitle><form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit().catch(() => onError(t("operationError"))); }}><SectionHeading icon={KeyRound} title={t("edit")} /><form.Field name="label" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("labelRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="edit-local-account-label">{t("label")}</Label><Input id="edit-local-account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} required /></div>}</form.Field><div className="grid gap-3"><div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" className="w-full" onClick={onCancel}>{t("cancel")}</Button><Button type="submit" className="w-full">{t("update")}</Button></div><span className="h-px bg-border" aria-hidden="true" /><Button type="button" variant="ghost" className="w-full justify-center text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 />{t("delete")}</Button></div></form></DialogContent></Dialog>{deleteOpen && <ConfirmationDialog title={t("deleteTitle")} description={t("deleteDescription")} confirmLabel={t("deleteConfirm")} danger pending={deleting} onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}</>;
}

function LocalVaultSettings({ vault, onLock, onClear, onRename, onError }: { vault: UnlockedLocalVault; onLock: () => void; onClear: () => void; onRename: (name: string) => Promise<void>; onError: (message: string) => void }) {
  const t = useTranslations("LocalVault");
  const form = useForm({ defaultValues: { name: vault.name }, onSubmit: async ({ value }) => {
    try {
      await onRename(value.name);
    } catch {
      onError(t("operationError"));
    }
  } });
  return <div className="grid gap-5"><SectionHeading icon={Settings} title={t("advancedTitle")} description={t("advancedDescription")} /><section className="grid gap-4 rounded-lg border border-border p-4"><div><h2 className="font-bold text-ink-strong">{t("renameTitle")}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("renameDescription")}</p></div><form noValidate className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}><form.Field name="name" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("nameRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="rename-local-vault">{t("name")}</Label><Input id="rename-local-vault" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="rename-local-vault-error" required /><FormFieldError id="rename-local-vault-error" errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <div className="flex justify-end"><Button className="w-full sm:w-fit" type="submit" disabled={isSubmitting}>{isSubmitting ? t("renaming") : t("rename")}</Button></div>}</form.Subscribe></form></section><section className="grid gap-3 rounded-lg border border-border p-4"><div><h2 className="font-bold text-ink-strong">{t("lock")}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("lockDescription")}</p></div><div className="flex justify-end"><Button type="button" variant="outline" className="w-full sm:w-fit" onClick={onLock}><LockKeyhole />{t("lock")}</Button></div></section><section className="grid gap-3 rounded-lg border border-destructive/30 p-4"><div><h2 className="font-bold text-ink-strong">{t("clear")}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{t("clearDescription")}</p></div><div className="flex justify-end"><Button type="button" variant="outline" className="w-full text-destructive hover:text-destructive sm:w-fit" onClick={onClear}><Trash2 />{t("clear")}</Button></div></section></div>;
}

function LocalArchiveImporter({ vault, onImported, onError, importing, setImporting }: { vault: UnlockedLocalVault; onImported: () => void; onError: (message: string) => void; importing: boolean; setImporting: (value: boolean) => void }) {
  const t = useTranslations("LocalVault");
  const [archive, setArchive] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  async function restore() {
    if (!archive || !key) return;
    setImporting(true);
    let keyBytes: Uint8Array | undefined;
    let archiveBytes: Uint8Array | undefined;
    try {
      keyBytes = base64ToBytes((await key.text()).trim());
      archiveBytes = new Uint8Array(await archive.arrayBuffer());
      const preview = await previewLocalVaultArchive(keyBytes, archiveBytes);
      for (const account of preview.accounts) account.secret.fill(0);
      const count = await importLocalVaultArchive(vault, keyBytes, archiveBytes);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultArchiveImportCompleted, { account_count: count });
      onImported();
      if (count === 0) onError(t("noNewAccounts"));
      else onError(t("imported", { count }));
    } catch { onError(t("importError")); }
    finally {
      keyBytes?.fill(0);
      archiveBytes?.fill(0);
      setImporting(false);
    }
  }
  return <div className="grid gap-3 rounded-md border border-border p-3"><p className="text-sm font-bold">{t("import")}</p><p className="text-xs leading-5 text-muted-foreground">{t("importDescription")}</p><Label className="grid gap-2 text-xs leading-5">{t("archiveFile")}<Input type="file" accept=".rhasia-vault,.rhasia,application/octet-stream" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} /></Label><Label className="grid gap-2 text-xs leading-5">{t("keyFile")}<Input type="file" accept=".txt,text/plain" onChange={(event) => setKey(event.target.files?.[0] ?? null)} /></Label><div className="flex justify-end"><Button variant="outline" className="w-full sm:w-fit" onClick={() => void restore()} disabled={!archive || !key || importing}>{importing ? t("importing") : t("import")}</Button></div></div>;
}

async function reloadLocalVault(current: UnlockedLocalVault, onChanged: (vault: UnlockedLocalVault) => void): Promise<void> {
  const refreshed = await refreshUnlockedLocalVault(current);
  onChanged(refreshed);
}

function download(bytes: Uint8Array, filename: string, type = "application/octet-stream"): void {
  browserDownload.download({ bytes, filename, mediaType: type });
}

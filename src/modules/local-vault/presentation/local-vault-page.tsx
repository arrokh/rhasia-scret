"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Download, KeyRound, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppPage, PageHeader, SectionHeading, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { parseTotpUri, type TotpConfiguration } from "@/modules/otp-runtime";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { QrImportInput } from "@/modules/authenticator-account";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import {
  addLocalAccount,
  clearLocalVault,
  clearUnlockedLocalVault,
  createLocalVault,
  deleteLocalAccount,
  exportLocalVault,
  importLocalVaultArchive,
  previewLocalVaultArchive,
  readLocalVaultRecord,
  refreshUnlockedLocalVault,
  unlockLocalVault,
  updateLocalAccount,
  type UnlockedLocalVault,
  type UnlockedLocalVaultAccount
} from "@/modules/local-vault";
import { BrowserLocalVaultRepository } from "../infrastructure/browser-local-vault-repository";
import type { LocalVaultRecord } from "../domain/local-vault-record";

export function LocalVaultPage() {
  const t = useTranslations("LocalVault");
  const [record, setRecord] = useState<LocalVaultRecord | null>(null);
  const [vault, setVault] = useState<UnlockedLocalVault | null>(null);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success" | "warning"; text: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [editing, setEditing] = useState<UnlockedLocalVaultAccount | null>(null);
  const vaultRef = useRef<UnlockedLocalVault | null>(null);
  useEffect(() => { vaultRef.current = vault; }, [vault]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) {
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
    } catch {
      setMessage({ tone: "danger", text: t("storageError") });
    } finally {
      setClearing(false);
    }
  }

  if (loading) return <AppPage><PageHeader title={t("title")} /><SurfaceCard className="p-6"><p role="status">{t("loading")}</p></SurfaceCard></AppPage>;
  if (unsupported) return <AppPage><PageHeader title={t("title")} /><SurfaceCard className="p-6"><StatusBanner tone="danger" role="alert">{t("unsupported")}</StatusBanner></SurfaceCard></AppPage>;

  return <AppPage>
    <PageHeader title={t("title")} description={t("description")} backHref="/" />
    {message && <div className="mb-5"><StatusBanner tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</StatusBanner></div>}
    {!record && <SurfaceCard className="grid gap-5 p-5 sm:p-6"><CreateLocalVaultForm onCreate={create} /></SurfaceCard>}
    {record && !vault && <SurfaceCard className="grid gap-5 p-5 sm:p-6"><UnlockLocalVaultForm onUnlock={unlock} /></SurfaceCard>}
    {record && vault && <UnlockedLocalVaultView vault={vault} onLock={lock} onChanged={(next) => { setVault(next); void readLocalVaultRecord().then(setRecord); }} onEdit={setEditing} onError={(text) => setMessage({ tone: "danger", text })} />}
    {record && <div className="mt-5 grid gap-3 sm:grid-cols-2"><Button variant="outline" onClick={() => setClearOpen(true)}><Trash2 />{t("clear")}</Button><p className="self-center text-xs leading-5 text-muted-foreground">{t("createDescription")}</p></div>}
    {clearOpen && <ConfirmationDialog title={t("clearTitle")} description={t("clearDescription")} confirmLabel={t("clearConfirm")} danger pending={clearing} onCancel={() => setClearOpen(false)} onConfirm={() => void handleClear()} />}
    {vault && editing && <LocalAccountEditor account={editing} onCancel={() => setEditing(null)} onSave={async (configuration) => { await updateLocalAccount(vault, editing.id, configuration); setEditing(null); setVault({ ...vault, accounts: [...vault.accounts] }); }} onError={(text) => setMessage({ tone: "danger", text })} />}
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

function UnlockLocalVaultForm({ onUnlock }: { onUnlock: (passphrase: string) => Promise<void> }) {
  const t = useTranslations("LocalVault");
  const [visible, setVisible] = useState(false);
  const form = useForm({ defaultValues: { passphrase: "" }, onSubmit: async ({ value }) => onUnlock(value.passphrase) });
  return <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
    <SectionHeading icon={LockKeyhole} title={t("unlockTitle")} description={t("unlockDescription")} />
    <form.Field name="passphrase" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("passphraseRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-vault-unlock">{t("passphrase")}</Label><PasswordInput id="local-vault-unlock" label={t("passphrase")} visible={visible} onToggleVisibility={() => setVisible((current) => !current)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-vault-unlock-error" required /><FormFieldError id="local-vault-unlock-error" errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? t("unlocking") : t("unlock")}</Button>}</form.Subscribe>
  </form>;
}

function UnlockedLocalVaultView({ vault, onLock, onChanged, onEdit, onError }: { vault: UnlockedLocalVault; onLock: () => void; onChanged: (vault: UnlockedLocalVault) => void; onEdit: (account: UnlockedLocalVaultAccount) => void; onError: (message: string) => void }) {
  const t = useTranslations("LocalVault");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UnlockedLocalVaultAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  async function add(configuration: TotpConfiguration) {
    try { await addLocalAccount(vault, configuration); onChanged({ ...vault, accounts: [...vault.accounts] }); }
    catch { configuration.secret.fill(0); onError(t("duplicate")); }
  }
  async function remove() {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await deleteLocalAccount(vault, deleteTarget.id); setDeleteTarget(null); onChanged({ ...vault, accounts: [...vault.accounts] }); }
    catch { onError(t("operationError")); }
    finally { setDeleting(false); }
  }
  async function backup() {
    setExporting(true);
    try {
      const result = await exportLocalVault(vault);
      download(result.archive, "local-vault.rhasia");
      download(new TextEncoder().encode(bytesToBase64(result.key)), "local-vault.key.txt", "text/plain");
      result.key.fill(0);
    } catch { onError(t("backupError")); }
    finally { setExporting(false); }
  }
  return <div className="grid gap-5">
    <SurfaceCard className="grid gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{t("deviceOnly")}</p><h2 className="mt-1 text-xl font-bold text-ink-strong">{vault.name}</h2><p className="mt-1 text-sm text-muted-foreground">{t("offline")}</p></div><Button variant="outline" onClick={onLock}><LockKeyhole />{t("lock")}</Button></div>
      <p className="text-sm font-semibold text-muted-foreground">{t("accountCount", { count: vault.accounts.length })}</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void backup()} disabled={exporting}><Download />{exporting ? t("exporting") : t("export")}</Button><LocalArchiveImporter vault={vault} onImported={() => void reloadLocalVault(vault, onChanged)} onError={onError} importing={importing} setImporting={setImporting} /></div>
    </SurfaceCard>
    <SurfaceCard className="grid gap-5 p-0"><div className="p-5 pb-0 sm:p-6 sm:pb-0"><AddLocalAccountForm onAdd={add} /></div><div className="h-px bg-border" />{vault.accounts.length ? <ul className="grid list-none gap-3 p-5 sm:p-6">{vault.accounts.map((account) => <li key={account.id} className="grid gap-2"><TotpAccountButton configuration={account} vaultName={vault.name} onManage={() => onEdit(account)} /><Button variant="ghost" className="justify-self-end text-destructive" onClick={() => setDeleteTarget(account)}><Trash2 />{t("delete")}</Button></li>)}</ul> : <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}</SurfaceCard>
    {deleteTarget && <ConfirmationDialog title={t("deleteTitle")} description={t("deleteDescription")} confirmLabel={t("deleteConfirm")} danger pending={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove()} />}
  </div>;
}

function AddLocalAccountForm({ onAdd }: { onAdd: (configuration: TotpConfiguration) => Promise<void> }) {
  const t = useTranslations("LocalVault");
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const form = useForm({ defaultValues: { uri: "", label: "" }, onSubmit: async ({ value }) => { if (!configuration) return; await onAdd({ ...configuration, accountName: value.label.trim() }); setConfiguration(null); form.reset(); } });
  function importUri(uri: string) { try { const parsed = parseTotpUri(uri); setConfiguration(parsed); form.setFieldValue("uri", uri); form.setFieldValue("label", parsed.accountName); } catch { setConfiguration(null); } }
  return <div className="grid gap-4"><SectionHeading icon={KeyRound} title={t("addTitle")} description={t("addDescription")} /><QrImportInput onUri={importUri} />{configuration && <form noValidate className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}><form.Field name="label" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("labelRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="local-account-label">{t("label")}</Label><Input id="local-account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="local-account-label-error" required /><FormFieldError id="local-account-label-error" errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : t("save")}</Button>}</form.Subscribe></form>}</div>;
}

function LocalAccountEditor({ account, onCancel, onSave, onError }: { account: UnlockedLocalVaultAccount; onCancel: () => void; onSave: (configuration: TotpConfiguration) => Promise<void>; onError: (message: string) => void }) {
  const t = useTranslations("LocalVault");
  const form = useForm({ defaultValues: { label: account.accountName }, onSubmit: async ({ value }) => onSave({ ...account, accountName: value.label.trim() }) });
  return <SurfaceCard className="fixed inset-x-4 bottom-20 z-50 grid gap-4 p-5 shadow-sheet sm:inset-x-auto sm:right-6 sm:w-96"><form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit().catch(() => onError(t("operationError"))); }}><SectionHeading icon={KeyRound} title={t("edit")} /><form.Field name="label" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("labelRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="edit-local-account-label">{t("label")}</Label><Input id="edit-local-account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} required /></div>}</form.Field><div className="flex gap-2"><Button type="button" variant="outline" onClick={onCancel}>{t("cancel")}</Button><Button type="submit">{t("update")}</Button></div></form></SurfaceCard>;
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
  return <div className="grid gap-3 rounded-md border border-border p-3"><p className="text-sm font-bold">{t("import")}</p><p className="text-xs leading-5 text-muted-foreground">{t("importDescription")}</p><Label className="text-xs">{t("archiveFile")}<Input type="file" accept=".rhasia,application/octet-stream" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} /></Label><Label className="text-xs">{t("keyFile")}<Input type="file" accept=".txt,text/plain" onChange={(event) => setKey(event.target.files?.[0] ?? null)} /></Label><Button variant="outline" onClick={() => void restore()} disabled={!archive || !key || importing}>{importing ? t("importing") : t("import")}</Button></div>;
}

async function reloadLocalVault(current: UnlockedLocalVault, onChanged: (vault: UnlockedLocalVault) => void): Promise<void> {
  const refreshed = await refreshUnlockedLocalVault(current);
  onChanged(refreshed);
}

function download(bytes: Uint8Array, filename: string, type = "application/octet-stream"): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}


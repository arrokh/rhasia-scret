"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Copy, LoaderCircle, LockKeyhole, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useCreateEncryptedAuthenticatorAccountMutation, encryptAccountConfiguration, type WorkspaceAuthenticatorAccount } from "@/modules/authenticator-account";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { addLocalAccount, clearUnlockedLocalVault, readLocalVaultRecord, refreshUnlockedLocalVault, unlockLocalVault, type UnlockedLocalVault } from "@/modules/local-vault";

export function LocalVaultCopyPanel({ personalVaultId, personalVaultName, personalVaultKey, personalAccounts, onPersonalAccountsCopied }: { personalVaultId: string; personalVaultName: string; personalVaultKey: Uint8Array; personalAccounts: WorkspaceAuthenticatorAccount[]; onPersonalAccountsCopied: (accounts: WorkspaceAuthenticatorAccount[]) => void }) {
  const t = useTranslations("LocalVaultCopy");
  const [recordAvailable, setRecordAvailable] = useState<boolean | null>(null);
  const [vault, setVault] = useState<UnlockedLocalVault | null>(null);
  const vaultRef = useRef<UnlockedLocalVault | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<Set<string>>(new Set());
  const [selectedPersonal, setSelectedPersonal] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"local" | "personal" | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const createMutation = useCreateEncryptedAuthenticatorAccountMutation();

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);
  useEffect(() => () => clearUnlockedLocalVault(vaultRef.current), []);
  useEffect(() => {
    let active = true;
    void readLocalVaultRecord().then((record) => { if (active) setRecordAvailable(record !== null); }).catch(() => { if (active) setRecordAvailable(false); });
    return () => { active = false; };
  }, []);

  async function unlock(passphrase: string) {
    const record = await readLocalVaultRecord();
    if (!record) throw new Error("The Local Profile is unavailable.");
    const next = await unlockLocalVault(record, passphrase);
    clearUnlockedLocalVault(vaultRef.current);
    setVault(next);
    setStatus(null);
  }

  async function copyLocalToPersonal() {
    if (!vault || !selectedLocal.size) return;
    setBusy("local");
    setStatus(null);
    const copied: WorkspaceAuthenticatorAccount[] = [];
    try {
      for (const account of vault.accounts.filter((entry) => selectedLocal.has(entry.id))) {
        const source = { ...account, secret: account.secret.slice() };
        try {
          const encryptedPayload = await encryptAccountConfiguration(personalVaultKey, source, { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: personalVaultId, keyVersion: 1 });
          const created = await createMutation.mutateAsync({ vaultId: personalVaultId, vaultType: "PERSONAL", encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 });
          copied.push({ ...account, id: created.id, vaultId: personalVaultId, vaultName: personalVaultName, vaultType: "PERSONAL", revision: created.revision });
        } finally {
          source.secret.fill(0);
        }
      }
      onPersonalAccountsCopied(copied);
      setSelectedLocal(new Set());
      setStatus({ tone: "success", text: t("localToPersonalSuccess", { count: copied.length }) });
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof BrowserApiError && error.status === 403 ? t("personalUnavailable") : t("partialFailure", { count: copied.length }) });
    } finally {
      setBusy(null);
    }
  }

  async function copyPersonalToLocal() {
    if (!vault || !selectedPersonal.size) return;
    setBusy("personal");
    setStatus(null);
    let copied = 0;
    try {
      for (const account of personalAccounts.filter((entry) => selectedPersonal.has(entry.id))) {
        const source = { issuer: account.issuer, accountName: account.accountName, secret: account.secret.slice(), algorithm: account.algorithm, digits: account.digits, period: account.period };
        await addLocalAccount(vault, source);
        copied += 1;
      }
      const refreshed = await refreshUnlockedLocalVault(vault);
      setVault(refreshed);
      setSelectedPersonal(new Set());
      setStatus({ tone: "success", text: t("personalToLocalSuccess", { count: copied }) });
    } catch {
      setStatus({ tone: "danger", text: copied ? t("partialLocalFailure", { count: copied }) : t("duplicateOrFailure") });
    } finally {
      setBusy(null);
    }
  }

  if (recordAvailable === null) return <p role="status">{t("checking")}</p>;
  if (!recordAvailable) return <div className="grid gap-3"><StatusBanner tone="info">{t("notCreated")}</StatusBanner><Button variant="outline" asChild><a href="/local">{t("openLocal")}</a></Button></div>;
  if (!vault) return <LocalVaultUnlockForm onUnlock={unlock} />;

  return <div className="grid gap-5">
    <StatusBanner tone="info" title={t("unlockedTitle")}>{t("unlockedDescription", { name: vault.name })}</StatusBanner>
    {status && <StatusBanner tone={status.tone} role={status.tone === "danger" ? "alert" : "status"}>{status.text}</StatusBanner>}
    <CopyList title={t("localAccounts")} empty={t("noLocalAccounts")} accounts={vault.accounts} selected={selectedLocal} onToggle={(id) => toggle(setSelectedLocal, id)} />
    <Button onClick={() => void copyLocalToPersonal()} disabled={!selectedLocal.size || busy !== null} aria-busy={busy === "local"}>{busy === "local" ? <LoaderCircle className="animate-spin" /> : <Upload />}{t("copyToPersonal")}</Button>
    <CopyList title={t("personalAccounts")} empty={t("noPersonalAccounts")} accounts={personalAccounts} selected={selectedPersonal} onToggle={(id) => toggle(setSelectedPersonal, id)} />
    <Button variant="outline" onClick={() => void copyPersonalToLocal()} disabled={!selectedPersonal.size || busy !== null} aria-busy={busy === "personal"}>{busy === "personal" ? <LoaderCircle className="animate-spin" /> : <Copy />}{t("copyToLocal")}</Button>
    <p className="text-xs leading-5 text-muted-foreground">{t("sourceUnchanged")}</p>
  </div>;
}

function LocalVaultUnlockForm({ onUnlock }: { onUnlock: (passphrase: string) => Promise<void> }) {
  const t = useTranslations("LocalVaultCopy");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);
  const form = useForm({ defaultValues: { passphrase: "" }, onSubmit: async ({ value }) => { setError(false); try { await onUnlock(value.passphrase); form.reset(); } catch { setError(true); } } });
  return <form noValidate className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}><div className="flex items-center gap-2"><LockKeyhole className="size-5" aria-hidden="true" /><div><h3 className="font-bold text-ink-strong">{t("unlockTitle")}</h3><p className="text-xs text-muted-foreground">{t("unlockDescription")}</p></div></div><form.Field name="passphrase" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("passphraseRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="copy-local-vault-passphrase">{t("passphrase")}</Label><PasswordInput id="copy-local-vault-passphrase" label={t("passphrase")} visible={visible} onToggleVisibility={() => setVisible((current) => !current)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby="copy-local-vault-passphrase-error" required /><FormFieldError id="copy-local-vault-passphrase-error" errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => state.isSubmitting}>{(submitting) => <Button type="submit" disabled={submitting}>{submitting ? t("unlocking") : t("unlock")}</Button>}</form.Subscribe>{error && <StatusBanner tone="danger" role="alert">{t("unlockError")}</StatusBanner>}</form>;
}

function CopyList({ title, empty, accounts, selected, onToggle }: { title: string; empty: string; accounts: Array<{ id: string; issuer: string; accountName: string }>; selected: Set<string>; onToggle: (id: string) => void }) {
  return <section className="grid gap-2" aria-label={title}><h3 className="text-sm font-bold text-ink-strong">{title}</h3>{accounts.length ? <ul className="grid list-none gap-2 p-0">{accounts.map((account) => <li key={account.id} className="flex items-center gap-3 rounded-md border border-border p-3"><Checkbox id={`copy-${account.id}`} checked={selected.has(account.id)} onCheckedChange={() => onToggle(account.id)} /><Label htmlFor={`copy-${account.id}`} className="min-w-0 cursor-pointer"><span className="block truncate font-semibold">{account.issuer}</span><span className="block truncate text-xs text-muted-foreground">{account.accountName}</span></Label></li>)}</ul> : <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">{empty}</p>}</section>;
}

function toggle(setter: (update: (current: Set<string>) => Set<string>) => void, id: string): void {
  setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
}

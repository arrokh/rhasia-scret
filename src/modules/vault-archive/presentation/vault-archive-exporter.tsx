"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Archive, Check, Clipboard, Download, KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnlockedVaultWorkspace, VaultWorkspaceUnlock, type UnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { recordVaultArchiveExport } from "@/modules/vault-management";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import {
  clearPreparedVaultArchive,
  downloadPreparedVaultArchive,
  prepareEncryptedVaultArchive,
  VaultArchiveExportError,
  type PreparedVaultArchive,
  type VaultArchiveExportErrorCode
} from "../infrastructure/browser-vault-archive-export-workflow";

type ExportMessageKey = "offlineUnavailable" | "vaultUnavailable" | "ownerRequired" | "tooLarge" | "accountMismatch" | "exportError" | "copyError";

export function VaultArchiveExportWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const t = useTranslations("VaultArchive.exporter");
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="offline">{t("blocked")}</StatusBanner><Button variant="outline" asChild><Link href="/vaults">{t("backReadOnly")}</Link></Button></div>;
  return <VaultArchiveExporter workspace={workspace} />;
}

export function VaultArchiveExporter({ workspace }: { workspace: UnlockedVaultWorkspace }) {
  const t = useTranslations("VaultArchive.exporter");
  const online = useOnlineStatus();
  const ownedVaults = workspace.vaults.filter((vault) => vault.role === "OWNER");
  const [prepared, setPreparedState] = useState<PreparedVaultArchive | null>(null);
  const preparedRef = useRef<PreparedVaultArchive | null>(null);
  const activeRef = useRef(true);
  const [message, setMessage] = useState<ExportMessageKey | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const form = useForm({
    defaultValues: { vaultId: ownedVaults[0]?.id ?? "", acknowledged: false },
    onSubmit: async ({ value }) => {
      clearResult();
      if (!online) { setMessage("offlineUnavailable"); return; }
      const vault = ownedVaults.find(({ id }) => id === value.vaultId);
      if (!vault) { setMessage("vaultUnavailable"); return; }
      let next: PreparedVaultArchive | null = null;
      try {
        next = await prepareEncryptedVaultArchive(vault, workspace.accounts.filter((account) => account.vaultId === vault.id));
        if (!activeRef.current) { clearPreparedVaultArchive(next); next = null; return; }
        await recordVaultArchiveExport(vault.id);
        if (!activeRef.current) { clearPreparedVaultArchive(next); next = null; return; }
        replacePrepared(next);
        next = null;
      } catch (error) {
        clearPreparedVaultArchive(next);
        if (activeRef.current) setMessage(exportErrorMessageKey(error));
      }
    }
  });

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      clearPreparedVaultArchive(preparedRef.current);
      preparedRef.current = null;
    };
  }, []);

  function replacePrepared(next: PreparedVaultArchive | null) {
    clearPreparedVaultArchive(preparedRef.current);
    preparedRef.current = next;
    setPreparedState(next);
  }

  function clearResult() {
    replacePrepared(null);
    setMessage(null);
    setCopied(false);
    setKeyVisible(false);
  }

  async function copyKey() {
    if (!prepared) return;
    try { await navigator.clipboard.writeText(prepared.keyMaterial); setCopied(true); }
    catch { setMessage("copyError"); }
  }

  function downloadKey() {
    if (!prepared) return;
    const url = URL.createObjectURL(new Blob([`${prepared.keyMaterial}\n`], { type: "text/plain" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = prepared.filename.replace(/\.rhasia-vault$/, ".key.txt");
      anchor.rel = "noopener";
      anchor.click();
    } finally { URL.revokeObjectURL(url); }
  }

  if (prepared) return <div className="grid gap-5 p-5 sm:p-6">
    <SectionHeading icon={KeyRound} title={t("saveKeyTitle")} description={t("saveKeyDescription")} />
    <StatusBanner tone="warning" title={t("bothRequiredTitle")}>{t("bothRequiredDescription")}</StatusBanner>
    <div className="grid gap-2"><Label htmlFor="generated-archive-key">{t("archiveKey")}</Label><PasswordInput id="generated-archive-key" label={t("archiveKey")} visible={keyVisible} onToggleVisibility={() => setKeyVisible((value) => !value)} value={prepared.keyMaterial} readOnly autoComplete="off" /></div>
    <div className="grid gap-2 sm:grid-cols-3"><Button type="button" onClick={() => downloadPreparedVaultArchive(prepared)}><Download />{t("downloadArchive")}</Button><Button variant="outline" type="button" onClick={() => void copyKey()}>{copied ? <Check /> : <Clipboard />}{copied ? t("keyCopied") : t("copyKey")}</Button><Button variant="outline" type="button" onClick={downloadKey}><Download />{t("downloadKey")}</Button></div>
    <Button variant="ghost" type="button" onClick={() => { clearResult(); form.reset(); }}>{t("done")}</Button>
    {message && <StatusBanner tone="danger" role="alert">{t(message)}</StatusBanner>}
  </div>;

  return <div className="grid gap-5 p-5 sm:p-6">
    {!online && <StatusBanner tone="offline">{t("offlineBlocked")}</StatusBanner>}
    <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <SectionHeading icon={Archive} title={t("createTitle")} description={t("createDescription")} />
      <form.Field name="vaultId" validators={{ onSubmit: ({ value }) => value ? undefined : t("vaultRequired") }}>{(field) => <div className="grid gap-2"><Label htmlFor="archive-export-vault">{t("vault")}</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="archive-export-vault" className="h-12 w-full" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "archive-export-vault-error" : undefined}><SelectValue placeholder={t("chooseVault")} /></SelectTrigger><SelectContent>{ownedVaults.map((vault) => <SelectItem key={vault.id} value={vault.id}>{t("vaultOption", { name: vault.name, count: workspace.accounts.filter((account) => account.vaultId === vault.id).length })}</SelectItem>)}</SelectContent></Select><FormFieldError id="archive-export-vault-error" errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Field name="acknowledged" validators={{ onSubmit: ({ value }) => value ? undefined : t("acknowledgementRequired") }}>{(field) => <div className="grid gap-2"><div className="flex items-start gap-3"><Checkbox id="archive-key-acknowledgement" checked={field.state.value} onCheckedChange={(value) => field.handleChange(value === true)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "archive-key-acknowledgement-error" : undefined} /><Label htmlFor="archive-key-acknowledgement" className="leading-5">{t("acknowledgement")}</Label></div><FormFieldError id="archive-key-acknowledgement-error" errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={!online || pending} aria-busy={pending}>{pending && <LoaderCircle className="animate-spin" />}{pending ? t("creating") : t("create")}</Button>}</form.Subscribe>
    </form>
    {message && <StatusBanner tone="danger" role="alert">{t(message)}</StatusBanner>}
  </div>;
}

function exportErrorMessageKey(error: unknown): ExportMessageKey {
  if (!(error instanceof VaultArchiveExportError)) return "exportError";
  const keys: Record<VaultArchiveExportErrorCode, ExportMessageKey> = {
    owner_required: "ownerRequired",
    too_large: "tooLarge",
    account_mismatch: "accountMismatch"
  };
  return keys[error.code];
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
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
  type PreparedVaultArchive
} from "../infrastructure/browser-vault-archive-export-workflow";

export function VaultArchiveExportWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="offline">Cadangan diblokir sampai sinkronisasi dan otorisasi kembali terkini. Ekspor tidak akan diantrikan.</StatusBanner><Button variant="outline" asChild><Link href="/vaults">Kembali ke kode baca-saja</Link></Button></div>;
  return <VaultArchiveExporter workspace={workspace} />;
}

export function VaultArchiveExporter({ workspace }: { workspace: UnlockedVaultWorkspace }) {
  const online = useOnlineStatus();
  const ownedVaults = workspace.vaults.filter((vault) => vault.role === "OWNER");
  const [prepared, setPreparedState] = useState<PreparedVaultArchive | null>(null);
  const preparedRef = useRef<PreparedVaultArchive | null>(null);
  const activeRef = useRef(true);
  const [message, setMessage] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const form = useForm({
    defaultValues: { vaultId: ownedVaults[0]?.id ?? "", acknowledged: false },
    onSubmit: async ({ value }) => {
      clearResult();
      if (!online) { setMessage("Cadangan tidak tersedia saat luring."); return; }
      const vault = ownedVaults.find(({ id }) => id === value.vaultId);
      if (!vault) { setMessage("Brankas tidak tersedia atau bukan milik Anda."); return; }
      let next: PreparedVaultArchive | null = null;
      try {
        next = await prepareEncryptedVaultArchive(vault, workspace.accounts.filter((account) => account.vaultId === vault.id));
        if (!activeRef.current) throw new Error("Cadangan dibatalkan karena Brankas dikunci.");
        await recordVaultArchiveExport(vault.id);
        if (!activeRef.current) { clearPreparedVaultArchive(next); next = null; return; }
        replacePrepared(next);
        next = null;
      } catch (error) {
        clearPreparedVaultArchive(next);
        if (activeRef.current) setMessage(error instanceof Error ? error.message : "Cadangan terenkripsi tidak dapat dibuat atau dicatat dalam audit.");
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
    setMessage("");
    setCopied(false);
    setKeyVisible(false);
  }

  async function copyKey() {
    if (!prepared) return;
    try { await navigator.clipboard.writeText(prepared.keyMaterial); setCopied(true); }
    catch { setMessage("Kunci tidak dapat disalin. Salin secara manual."); }
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
    <SectionHeading icon={KeyRound} title="Simpan kunci cadangan" description="Ekspor telah dicatat dalam Riwayat Audit. Unduh arsip dan simpan kunci di lokasi terpisah." />
    <StatusBanner tone="warning" title="Keduanya diperlukan untuk pemulihan">Arsip tidak dapat dibuka tanpa kunci ini. Menyimpan arsip dan kunci bersama-sama mengurangi perlindungan cadangan.</StatusBanner>
    <div className="grid gap-2"><Label htmlFor="generated-archive-key">Kunci arsip Base64</Label><PasswordInput id="generated-archive-key" label="kunci arsip" visible={keyVisible} onToggleVisibility={() => setKeyVisible((value) => !value)} value={prepared.keyMaterial} readOnly autoComplete="off" /></div>
    <div className="grid gap-2 sm:grid-cols-3"><Button type="button" onClick={() => downloadPreparedVaultArchive(prepared)}><Download />Unduh arsip</Button><Button variant="outline" type="button" onClick={() => void copyKey()}>{copied ? <Check /> : <Clipboard />}{copied ? "Kunci disalin" : "Salin kunci"}</Button><Button variant="outline" type="button" onClick={downloadKey}><Download />Unduh kunci</Button></div>
    <Button variant="ghost" type="button" onClick={() => { clearResult(); form.reset(); }}>Selesai dan hapus kunci dari layar</Button>
    {message && <StatusBanner tone="danger" role="alert">{message}</StatusBanner>}
  </div>;

  return <div className="grid gap-5 p-5 sm:p-6">
    {!online && <StatusBanner tone="offline">Anda luring. Cadangan diblokir dan tidak akan diantrikan.</StatusBanner>}
    <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <SectionHeading icon={Archive} title="Buat cadangan terenkripsi" description="Nama Brankas dan konfigurasi TOTP dienkripsi seluruhnya di browser dengan kunci acak 32-byte." />
      <form.Field name="vaultId" validators={{ onSubmit: ({ value }) => value ? undefined : "Pilih Brankas." }}>{(field) => <div className="grid gap-2"><Label htmlFor="archive-export-vault">Brankas</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="archive-export-vault" className="h-12 w-full" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "archive-export-vault-error" : undefined}><SelectValue placeholder="Pilih Brankas" /></SelectTrigger><SelectContent>{ownedVaults.map((vault) => <SelectItem key={vault.id} value={vault.id}>{vault.name} · {workspace.accounts.filter((account) => account.vaultId === vault.id).length} akun</SelectItem>)}</SelectContent></Select><FormFieldError id="archive-export-vault-error" errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Field name="acknowledged" validators={{ onSubmit: ({ value }) => value ? undefined : "Konfirmasikan bahwa Anda akan menyimpan kunci secara terpisah." }}>{(field) => <div className="grid gap-2"><div className="flex items-start gap-3"><Checkbox id="archive-key-acknowledgement" checked={field.state.value} onCheckedChange={(value) => field.handleChange(value === true)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "archive-key-acknowledgement-error" : undefined} /><Label htmlFor="archive-key-acknowledgement" className="leading-5">Saya akan menyimpan kunci arsip secara terpisah dan memahami bahwa cadangan tidak diperbarui otomatis.</Label></div><FormFieldError id="archive-key-acknowledgement-error" errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={!online || pending} aria-busy={pending}>{pending && <LoaderCircle className="animate-spin" />}{pending ? "Mengenkripsi dan mencatat audit…" : "Buat cadangan"}</Button>}</form.Subscribe>
    </form>
    {message && <StatusBanner tone="danger" role="alert">{message}</StatusBanner>}
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "@tanstack/react-form";
import { Fingerprint, KeyRound, Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser,
  refreshUnlockedVaultWorkspace,
  type UnlockedVaultWorkspace
} from "@/modules/authenticator-account";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { AppPage, Brand, PageHeader, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { setBrowserWritesReadOnly } from "@/shared/infrastructure/browser-write-policy";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { BrowserOfflineVaultRepository } from "../infrastructure/browser-offline-vault-repository";
import { subscribeToLocalVaultLock } from "../infrastructure/browser-vault-lock";
import { nextOfflineSyncState, type OfflineSyncState } from "../domain/offline-sync-state";
import type { OfflineProfileSummary } from "../infrastructure/browser-offline-vault-repository";

export function OfflineVaultShell() {
  const [profiles, setProfiles] = useState<OfflineProfileSummary[]>([]);
  const [workspace, setWorkspace] = useState<UnlockedVaultWorkspace | null>(null);
  const workspaceRef = useRef(workspace);
  const reconcileRef = useRef<() => Promise<void>>(async () => undefined);
  const reconcilingRef = useRef(false);
  const hadWorkspaceRef = useRef(false);
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

  function replaceWorkspace(next: UnlockedVaultWorkspace | null) {
    setWorkspace((current) => {
      if (current && current !== next) clearUnlockedVaultWorkspace(current);
      return next;
    });
  }

  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);
  useEffect(() => subscribeToLocalVaultLock(() => setWorkspace((current) => {
    clearUnlockedVaultWorkspace(current);
    return null;
  })), []);
  useEffect(() => {
    setBrowserWritesReadOnly(workspace?.syncState === "CURRENT" ? null : "Offline Vault shell is read-only.");
    return () => setBrowserWritesReadOnly(null);
  }, [workspace?.syncState]);

  useEffect(() => {
    let active = true;
    repository.listProfiles().then((items) => {
      if (!active) return;
      setProfiles(items);
      if (items[0]) form.setFieldValue("profileId", items[0].profileId);
      setStatus(items.length ? "ready" : "empty");
    }).catch(() => { if (active) setStatus("storage_error"); });
    return () => { active = false; const current = workspaceRef.current; if (current) clearUnlockedVaultWorkspace(current); };
  }, [form, repository]);

  useEffect(() => {
    let active = true;
    const offline = () => setWorkspace((current) => current ? { ...current, syncState: nextOfflineSyncState(current.syncState, "NETWORK_LOST") } : current);
    const reconcile = async () => {
      const current = workspaceRef.current;
      if (!active || reconcilingRef.current || !navigator.onLine || !current || current.syncState === "CURRENT" || current.syncState === "SYNCING") return;
      reconcilingRef.current = true;
      setWorkspace((value) => value ? { ...value, syncState: nextOfflineSyncState(value.syncState, "RECONNECT_STARTED") } : value);
      try {
        const refreshed = await refreshUnlockedVaultWorkspace(current.userRootKey, current.profileId);
        if (!active) { clearUnlockedVaultWorkspace(refreshed); return; }
        replaceWorkspace({ ...refreshed, syncState: "CURRENT" });
      } catch (error) {
        if (!active) return;
        const event = error instanceof BrowserApiError && error.status === 401 ? "AUTHENTICATION_FAILED" : "SYNC_FAILED";
        setWorkspace((value) => value ? { ...value, syncState: nextOfflineSyncState("SYNCING", event) } : value);
      } finally {
        reconcilingRef.current = false;
      }
    };
    reconcileRef.current = reconcile;
    const visible = () => { if (document.visibilityState === "visible") void reconcile(); };
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("offline", offline); window.removeEventListener("online", reconcile); document.removeEventListener("visibilitychange", visible); };
  }, []);

  useEffect(() => {
    const newlyUnlocked = workspace !== null && !hadWorkspaceRef.current;
    hadWorkspaceRef.current = workspace !== null;
    if (newlyUnlocked && navigator.onLine) void reconcileRef.current();
  }, [workspace]);

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
    <PageHeader title="Akses brankas luring" description="Buka snapshot terenkripsi di perangkat ini tanpa menghubungi server." action={<Brand compact />} />
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <StatusBanner tone="offline" title="Mode baca-saja">Otorisasi tidak dapat diperiksa sampai sinkronisasi daring berhasil. Perubahan dan audit akses tidak disimpan atau diputar ulang.</StatusBanner>
      {status === "loading" && <p className="text-sm text-muted-foreground">Mencari snapshot terenkripsi…</p>}
      {status === "empty" && <StatusBanner tone="warning">Belum ada snapshot lokal. Buka brankas sekali saat daring untuk menyinkronkan perangkat ini.</StatusBanner>}
      {profiles.length > 0 && <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
        <form.Field name="profileId">{(field) => <div className="grid gap-2"><Label htmlFor="offline-profile">Profil lokal anonim</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="offline-profile" className="w-full"><SelectValue placeholder="Pilih snapshot" /></SelectTrigger><SelectContent>{profiles.map((profile, index) => <SelectItem key={profile.profileId} value={profile.profileId}>Snapshot {index + 1} · {new Date(profile.synchronizedAt).toLocaleString("id-ID")} · {profile.sharedVaultCount + 1} brankas</SelectItem>)}</SelectContent></Select></div>}</form.Field>
        <form.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>{(field) => <div className="grid gap-2"><Label htmlFor="offline-secret">Passphrase Brankas</Label><PasswordInput id="offline-secret" label="Passphrase Brankas" visible={secretVisible} onToggleVisibility={() => setSecretVisible((value) => !value)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "offline-secret-error" : undefined} autoComplete="current-password" required /><FormFieldError id="offline-secret-error" errors={field.state.meta.errors} /></div>}</form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={pending} aria-busy={pending}><KeyRound />{pending ? "Membuka…" : "Buka dengan Passphrase Brankas"}</Button>}</form.Subscribe>
        <Button type="button" variant="outline" onClick={() => void unlockRemembered()}><Fingerprint />Buka dengan Verifikasi Lokal</Button>
      </form>}
      {status === "unlock_error" && <StatusBanner tone="danger" role="alert">Passphrase atau snapshot tidak valid. Tidak ada data parsial yang dibuka.</StatusBanner>}
      {status === "remembered_error" && <StatusBanner tone="warning">Verifikasi Lokal gagal atau PRF tidak tersedia. Gunakan Passphrase Brankas.</StatusBanner>}
      {status === "storage_error" && <StatusBanner tone="danger" role="alert">Penyimpanan snapshot lokal tidak dapat dibuka. Data lama tidak dihapus.</StatusBanner>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/">Kembali ke masuk</Link></Button>{profiles.length > 0 && <Button type="button" variant="ghost" className="text-destructive" onClick={() => void clearDevice()}><Trash2 />Hapus data perangkat</Button>}</div>
    </SurfaceCard>
  </AppPage>;
}

function UnlockedOfflineWorkspace({ workspace, onLock, onClear }: { workspace: UnlockedVaultWorkspace; onLock: () => void; onClear: () => void }) {
  return <AppPage>
    <PageHeader title="Akun autentikator luring" description={`Snapshot ${new Date(workspace.synchronizedAt).toLocaleString("id-ID")}`} action={<Button variant="outline" onClick={onLock}><Lock />Kunci</Button>} />
    <SurfaceCard className="grid gap-5 p-4 sm:p-5">
      <StatusBanner tone={workspace.syncState === "CURRENT" ? "success" : "offline"} title={syncTitle(workspace.syncState)}>{workspace.syncState === "CURRENT" ? <>Sinkronisasi lengkap berhasil. <Link href="/vaults" className="font-bold underline">Lanjutkan ke aplikasi daring</Link>.</> : "Snapshot tetap usang dan baca-saja sampai otorisasi daring serta sinkronisasi lengkap berhasil. OTP memakai waktu perangkat; pemeriksaan drift dan audit akses tidak tersedia."}</StatusBanner>
      {workspace.unavailableSharedVaults > 0 && <StatusBanner tone="danger">{workspace.unavailableSharedVaults} Brankas Bersama tidak dapat didekripsi.</StatusBanner>}
      <ul className="grid list-none gap-3 p-0">{workspace.accounts.map((account) => <li key={`${account.vaultId}:${account.id}`}><TotpAccountButton configuration={account} vaultName={account.vaultName} /></li>)}</ul>
      {!workspace.accounts.length && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Snapshot ini tidak berisi akun autentikator.</p>}
      <Button type="button" variant="ghost" className="justify-self-start text-destructive" onClick={onClear}><Trash2 />Hapus snapshot dan Browser yang Diingat</Button>
    </SurfaceCard>
  </AppPage>;
}

function syncTitle(state: OfflineSyncState): string {
  return ({ OFFLINE: "Luring · baca-saja", STALE: "Sinkronisasi gagal · snapshot dipertahankan", SYNCING: "Memeriksa otorisasi dan sinkronisasi…", CURRENT: "Snapshot terkini", AUTH_REQUIRED: "Masuk kembali diperlukan", ERROR: "Kesalahan sinkronisasi" })[state];
}

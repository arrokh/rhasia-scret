"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { parseTotpUri } from "@/modules/otp-runtime";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration, isDuplicateAccount, type DecryptedAuthenticatorAccount } from "../infrastructure/browser-account-payload";
import { loadUnlockedVaultWorkspace, type UnlockedVaultWorkspace } from "../infrastructure/browser-vault-workspace";
import { QrImportInput } from "./qr-import-input";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { useCreateEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";

export function AuthenticatorAccountCreator({ personalVaultId, preferredVaultId }: { personalVaultId: string; preferredVaultId?: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const [duplicate, setDuplicate] = useState<DecryptedAuthenticatorAccount | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [message, setMessage] = useState("");
  const createAccountMutation = useCreateEncryptedAuthenticatorAccountMutation();
  const initialVaultId = workspace ? selectWritableVaultId(workspace, preferredVaultId) : "";
  const accountForm = useForm({
    defaultValues: { selectedVaultId: initialVaultId, uri: "", accountLabel: "" },
    onSubmit: async ({ value }) => {
      if (!workspace || !online) return;
      try {
        const candidate = { ...parseTotpUri(value.uri), accountName: value.accountLabel.trim() };
        if (isDuplicateAccount(candidate, workspace.accounts.filter((account) => account.vaultId === value.selectedVaultId))) { setDuplicate(candidate); return; }
        await save(candidate, value.selectedVaultId);
      } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini."); }
    }
  });

  function updateAuthenticatorUri(uri: string) { accountForm.setFieldValue("uri", uri); accountForm.setFieldValue("accountLabel", parseAuthenticatorMetadata(uri)?.accountName ?? ""); }
  function openWorkspace(unlocked: UnlockedVaultWorkspace) { setWorkspace(unlocked); accountForm.setFieldValue("selectedVaultId", selectWritableVaultId(unlocked, preferredVaultId)); setMessage(unlocked.unavailableSharedVaults > 0 ? `${unlocked.unavailableSharedVaults} Brankas Bersama tidak dapat dibuka dan tidak tersedia sebagai tujuan.` : ""); }

  const unlockForm = useForm({ defaultValues: { secret: "" }, onSubmit: async ({ value }) => { try { openWorkspace(await loadUnlockedVaultWorkspace(value.secret, personalVaultId)); unlockForm.reset(); } catch { setMessage("Tidak dapat membuka brankas Anda."); } } });

  async function saveDuplicate() { if (!duplicate) return; try { await save(duplicate, accountForm.state.values.selectedVaultId); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini."); } }
  async function save(candidate: DecryptedAuthenticatorAccount, selectedVaultId: string) {
    if (!workspace) return;
    const vault = workspace.vaults.find((entry) => entry.id === selectedVaultId);
    if (!vault || (vault.type === "SHARED" && vault.role !== "OWNER")) throw new Error("Brankas tujuan tidak dapat diubah.");
    const encryptedPayload = await encryptAccountConfiguration(vault.key, candidate);
    const created = await createAccountMutation.mutateAsync({ vaultId: vault.id, vaultType: vault.type, encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 });
    setWorkspace({ ...workspace, accounts: [...workspace.accounts, { ...candidate, id: created.id, revision: created.revision, vaultId: vault.id, vaultName: vault.name, vaultType: vault.type }].sort((left, right) => left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName)) });
    setDuplicate(null); router.push("/vaults"); router.refresh();
  }

  if (!workspace) return (
    <form noValidate className="grid gap-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void unlockForm.handleSubmit(); }}>
      <SectionHeading icon={KeyRound} title="Buka brankas" description="Masukkan Passphrase Brankas untuk memilih tujuan akun. Passphrase tetap di browser ini." />
      <unlockForm.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>{(field) => <Field><Label htmlFor="account-vault-unlock-secret">Passphrase Brankas</Label><PasswordInput id="account-vault-unlock-secret" label="Passphrase Brankas" visible={secretVisible} onToggleVisibility={() => setSecretVisible((visible) => !visible)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-unlock-error" : undefined} required /><FormFieldError id="account-unlock-error" errors={field.state.meta.errors} /></Field>}</unlockForm.Field>
      <unlockForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <LoaderCircle className="animate-spin" />}{isSubmitting ? "Membuka brankas…" : "Lanjutkan"}</Button>}</unlockForm.Subscribe>
      {message && <StatusBanner tone="danger" role="alert">{message}</StatusBanner>}
    </form>
  );

  const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
  return <>
    {!online && <div className="m-5 mb-0"><StatusBanner tone="offline">Anda luring. Akun baru tidak dapat disimpan.</StatusBanner></div>}
    <QrImportInput onUri={updateAuthenticatorUri} />
    <Separator />
    <form noValidate className="grid gap-5 bg-muted/30 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void accountForm.handleSubmit(); }}>
      <SectionHeading icon={ShieldCheck} title="Tinjau akun" description="Periksa detail dan pilih brankas tujuan sebelum menyimpan." />
      <accountForm.Field name="selectedVaultId" validators={{ onSubmit: requiredText("Brankas tujuan") }}>{(field) => <Field><Label htmlFor="account-target-vault">Simpan ke brankas</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="account-target-vault" className="h-12 w-full bg-card" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-target-vault-error" : undefined}><SelectValue placeholder="Pilih brankas" /></SelectTrigger><SelectContent>{writableVaults.map((vault) => <SelectItem key={vault.id} value={vault.id}>{vault.name}</SelectItem>)}</SelectContent></Select><FormFieldError id="account-target-vault-error" errors={field.state.meta.errors} /></Field>}</accountForm.Field>
      <accountForm.Field name="uri" validators={{ onSubmit: requiredText("URI autentikator") }}>{(field) => <Field><Label htmlFor="account-uri">URI autentikator</Label><Input id="account-uri" value={field.state.value} placeholder="Pindai atau unggah kode QR" autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-uri-error" : "account-uri-help"} required readOnly /><p id="account-uri-help" className="text-xs text-muted-foreground">URI berasal dari kode QR dan tidak dapat diedit. URI dan rahasianya hanya diproses di browser ini.</p><FormFieldError id="account-uri-error" errors={field.state.meta.errors} /></Field>}</accountForm.Field>
      <accountForm.Subscribe selector={(state) => state.values.uri}>{(uri) => { const metadata = parseAuthenticatorMetadata(uri); if (!metadata) return null; return <section className="grid gap-4 rounded-lg border border-warning/25 bg-warning-surface p-4" aria-labelledby="authenticator-metadata-title"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-wider text-warning uppercase">Pratinjau</p><h3 id="authenticator-metadata-title" className="mt-1 font-bold text-ink-strong">Metadata autentikator</h3></div><Badge className="bg-success-surface text-success">Rahasia terdeteksi</Badge></div><accountForm.Field name="accountLabel" validators={{ onSubmit: requiredText("Label akun") }}>{(field) => <Field><Label htmlFor="account-label">Label akun</Label><Input id="account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-label-help account-label-error" : "account-label-help"} required /><p id="account-label-help" className="text-xs leading-5 text-muted-foreground">Label tampil di daftar akun dan disimpan terenkripsi.</p><FormFieldError id="account-label-error" errors={field.state.meta.errors} /></Field>}</accountForm.Field><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Penerbit", metadata.issuer], ["Algoritma", metadata.algorithm], ["Digit", metadata.digits], ["Periode", `${metadata.period} detik`]].map(([term, value]) => <div key={term} className="rounded-md bg-card p-3"><dt className="text-[0.68rem] font-bold text-muted-foreground uppercase">{term}</dt><dd className="mt-1 truncate text-sm font-bold text-foreground">{value}</dd></div>)}</dl></section>; }}</accountForm.Subscribe>
      <accountForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={!online || isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Menyimpan…" : "Simpan akun"}</Button>}</accountForm.Subscribe>
    </form>
    {duplicate && <div className="m-5 mt-0"><StatusBanner tone="warning" title="Akun serupa sudah ada"><span>Akun yang sama sudah ada di brankas ini.</span><span className="mt-3 flex gap-2"><Button size="sm" variant="outline" type="button" onClick={() => setDuplicate(null)}>Batal</Button><Button size="sm" type="button" onClick={() => void saveDuplicate()} disabled={!online}>Tetap tambahkan</Button></span></StatusBanner></div>}
    {message && <div className="m-5 mt-0"><StatusBanner tone="danger" role="alert">{message}</StatusBanner></div>}
  </>;
}

function Field({ children }: { children: React.ReactNode }) { return <div className="grid gap-2">{children}</div>; }
function parseAuthenticatorMetadata(uri: string): ReturnType<typeof parseTotpUri> | null { if (!uri.trim()) return null; try { return parseTotpUri(uri); } catch { return null; } }
function selectWritableVaultId(workspace: UnlockedVaultWorkspace, preferredVaultId?: string): string { const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER"); return writableVaults.find((vault) => vault.id === preferredVaultId)?.id ?? writableVaults[0]?.id ?? ""; }

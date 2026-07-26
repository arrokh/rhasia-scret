"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { parseTotpUri } from "@/modules/otp-runtime";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
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
  const [message, setMessage] = useState("");
  const createAccountMutation = useCreateEncryptedAuthenticatorAccountMutation();
  const initialVaultId = workspace ? selectWritableVaultId(workspace, preferredVaultId) : "";

  const accountForm = useForm({
    defaultValues: { selectedVaultId: initialVaultId, uri: "", accountLabel: "" },
    onSubmit: async ({ value }) => {
      if (!workspace || !online) return;
      try {
        const candidate = { ...parseTotpUri(value.uri), accountName: value.accountLabel.trim() };
        const existing = workspace.accounts.filter((account) => account.vaultId === value.selectedVaultId);
        if (isDuplicateAccount(candidate, existing)) {
          setDuplicate(candidate);
          return;
        }
        await save(candidate, value.selectedVaultId);
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini.");
      }
    }
  });

  function updateAuthenticatorUri(uri: string) {
    accountForm.setFieldValue("uri", uri);
    accountForm.setFieldValue("accountLabel", parseAuthenticatorMetadata(uri)?.accountName ?? "");
  }

  function openWorkspace(unlocked: UnlockedVaultWorkspace) {
    setWorkspace(unlocked);
    accountForm.setFieldValue("selectedVaultId", selectWritableVaultId(unlocked, preferredVaultId));
    setMessage(unlocked.unavailableSharedVaults > 0
      ? `${unlocked.unavailableSharedVaults} Brankas Bersama tidak dapat dibuka dan tidak tersedia sebagai tujuan.`
      : "");
  }

  const unlockForm = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      try {
        openWorkspace(await loadUnlockedVaultWorkspace(value.secret, personalVaultId));
        unlockForm.reset();
      } catch {
        setMessage("Tidak dapat membuka brankas Anda.");
      }
    }
  });

  async function saveDuplicate() {
    if (!duplicate) return;
    try {
      await save(duplicate, accountForm.state.values.selectedVaultId);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Tidak dapat menambahkan akun ini.");
    }
  }

  async function save(candidate: DecryptedAuthenticatorAccount, selectedVaultId: string) {
    if (!workspace) return;
    const vault = workspace.vaults.find((entry) => entry.id === selectedVaultId);
    if (!vault || (vault.type === "SHARED" && vault.role !== "OWNER")) throw new Error("Brankas tujuan tidak dapat diubah.");
    const encryptedPayload = await encryptAccountConfiguration(vault.key, candidate);
    const created = await createAccountMutation.mutateAsync({
      vaultId: vault.id,
      vaultType: vault.type,
      encryptedPayload: bytesToBase64(encryptedPayload),
      encryptionVersion: 1
    });
    setWorkspace({
      ...workspace,
      accounts: [...workspace.accounts, {
        ...candidate,
        id: created.id,
        revision: created.revision,
        vaultId: vault.id,
        vaultName: vault.name,
        vaultType: vault.type
      }].sort((left, right) => left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName))
    });
    setDuplicate(null);
    router.push("/vaults");
    router.refresh();
  }

  if (!workspace) {
    return (
      <form noValidate className="auth-form vault-unlock-form account-unlock-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void unlockForm.handleSubmit(); }}>
        <div className="account-section-heading">
          <span className="account-section-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2" /></svg>
          </span>
          <div>
            <h2>Buka brankas</h2>
            <p>Masukkan Passphrase Brankas untuk memilih tujuan akun. Passphrase tetap di browser ini.</p>
          </div>
        </div>
        <unlockForm.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>
          {(field) => <div className="account-field"><label htmlFor="account-vault-unlock-secret">Passphrase Brankas</label><input id="account-vault-unlock-secret" type="password" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-unlock-error" : undefined} required /><FormFieldError id="account-unlock-error" errors={field.state.meta.errors} /></div>}
        </unlockForm.Field>
        <div className="form-actions unlock-form-actions">
          <unlockForm.Subscribe selector={(formState) => formState.isSubmitting}>
            {(isSubmitting) => <button className="primary-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Membuka brankas…" : "Lanjutkan"}</button>}
          </unlockForm.Subscribe>
        </div>
        {message && <p className="form-status" role="alert">{message}</p>}
      </form>
    );
  }

  const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
  return (
    <>
      {!online && <p className="offline-notice" role="status">Luring: akun baru tidak dapat disimpan.</p>}
      <QrImportInput onUri={updateAuthenticatorUri} />
      <form noValidate className="auth-form add-account-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void accountForm.handleSubmit(); }}>
        <div className="account-section-heading">
          <span className="account-section-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3 4 7v4c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V7l-8-4Zm-3 9 2 2 4-4" /></svg>
          </span>
          <div>
            <h2>Detail penyimpanan</h2>
            <p>Pilih brankas tujuan dan periksa URI sebelum menyimpan.</p>
          </div>
        </div>
        <div className="account-fields">
          <accountForm.Field name="selectedVaultId" validators={{ onSubmit: requiredText("Brankas tujuan") }}>
            {(field) => <div className="account-field"><label htmlFor="account-target-vault">Simpan ke brankas</label><select id="account-target-vault" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-target-vault-error" : undefined} required>{writableVaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}</select><FormFieldError id="account-target-vault-error" errors={field.state.meta.errors} /></div>}
          </accountForm.Field>
          <accountForm.Field name="uri" validators={{ onSubmit: requiredText("URI autentikator") }}>
            {(field) => <div className="account-field"><label htmlFor="account-uri">URI autentikator</label><input id="account-uri" value={field.state.value} onChange={(event) => updateAuthenticatorUri(event.target.value)} placeholder="otpauth://totp/…" autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-uri-error" : undefined} required disabled={!online} /><FormFieldError id="account-uri-error" errors={field.state.meta.errors} /></div>}
          </accountForm.Field>
          <accountForm.Subscribe selector={(formState) => formState.values.uri}>
            {(uri) => {
              const metadata = parseAuthenticatorMetadata(uri);
              if (!metadata) return null;
              return (
                <section className="authenticator-metadata" aria-labelledby="authenticator-metadata-title">
                  <div className="authenticator-metadata-heading">
                    <div><p className="eyebrow">PRATINJAU</p><h3 id="authenticator-metadata-title">Metadata autentikator</h3></div>
                    <span>Rahasia terdeteksi</span>
                  </div>
                  <accountForm.Field name="accountLabel" validators={{ onSubmit: requiredText("Label akun") }}>
                    {(field) => <div className="account-field"><label htmlFor="account-label">Label akun</label><input id="account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-label-help account-label-error" : "account-label-help"} required /><small id="account-label-help" className="field-help">Label ini akan tampil di daftar akun dan disimpan dalam keadaan terenkripsi.</small><FormFieldError id="account-label-error" errors={field.state.meta.errors} /></div>}
                  </accountForm.Field>
                  <dl className="authenticator-metadata-grid">
                    <div><dt>Penerbit</dt><dd>{metadata.issuer}</dd></div>
                    <div><dt>Algoritma</dt><dd>{metadata.algorithm}</dd></div>
                    <div><dt>Digit</dt><dd>{metadata.digits}</dd></div>
                    <div><dt>Periode</dt><dd>{metadata.period} detik</dd></div>
                  </dl>
                </section>
              );
            }}
          </accountForm.Subscribe>
        </div>
        <div className="form-actions account-form-actions">
          <Link className="secondary-link" href="/vaults">Batal</Link>
          <accountForm.Subscribe selector={(formState) => formState.isSubmitting}>
            {(isSubmitting) => <button className="primary-button" type="submit" disabled={!online || isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Menyimpan…" : "Simpan akun"}</button>}
          </accountForm.Subscribe>
        </div>
      </form>
      {duplicate && <aside className="duplicate-account"><p>Akun yang sama sudah ada di brankas ini.</p><button className="secondary-button" type="button" onClick={() => setDuplicate(null)}>Batal</button><button className="primary-button" type="button" onClick={() => void saveDuplicate()} disabled={!online}>Tetap tambahkan</button></aside>}
      {message && <p className="form-status" role="alert">{message}</p>}
    </>
  );
}

function parseAuthenticatorMetadata(uri: string): ReturnType<typeof parseTotpUri> | null {
  if (!uri.trim()) return null;
  try {
    return parseTotpUri(uri);
  } catch {
    return null;
  }
}

function selectWritableVaultId(workspace: UnlockedVaultWorkspace, preferredVaultId?: string): string {
  const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
  return writableVaults.find((vault) => vault.id === preferredVaultId)?.id ?? writableVaults[0]?.id ?? "";
}

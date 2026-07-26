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
import { useCreateEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";

export function AuthenticatorAccountCreator({ personalVaultId }: { personalVaultId: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [workspace, setWorkspace] = useState<UnlockedVaultWorkspace | null>(null);
  const [duplicate, setDuplicate] = useState<DecryptedAuthenticatorAccount | null>(null);
  const [message, setMessage] = useState("");
  const createAccountMutation = useCreateEncryptedAuthenticatorAccountMutation();
  const unlockForm = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      try {
        const unlocked = await loadUnlockedVaultWorkspace(value.secret, personalVaultId);
        const writableVaults = unlocked.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
        setWorkspace(unlocked);
        accountForm.setFieldValue("selectedVaultId", writableVaults[0]?.id ?? "");
        unlockForm.reset();
        setMessage(unlocked.unavailableSharedVaults > 0
          ? `${unlocked.unavailableSharedVaults} Brankas Bersama tidak dapat dibuka dan tidak tersedia sebagai tujuan.`
          : "");
      } catch {
        setMessage("Tidak dapat membuka brankas Anda.");
      }
    }
  });
  const accountForm = useForm({
    defaultValues: { selectedVaultId: "", uri: "" },
    onSubmit: async ({ value }) => {
      if (!workspace || !online) return;
      try {
        const candidate = parseTotpUri(value.uri);
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
    await createAccountMutation.mutateAsync({
      vaultId: vault.id,
      vaultType: vault.type,
      encryptedPayload: bytesToBase64(encryptedPayload),
      encryptionVersion: 1
    });
    setDuplicate(null);
    router.push("/vaults");
    router.refresh();
  }

  if (!workspace) {
    return (
      <form noValidate className="auth-form vault-unlock-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void unlockForm.handleSubmit(); }}>
        <p className="vault-flow-copy">Buka brankas untuk memilih tujuan akun. Passphrase Brankas tetap di browser ini.</p>
        <unlockForm.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>
          {(field) => <><label htmlFor="account-vault-unlock-secret">Passphrase Brankas</label><input id="account-vault-unlock-secret" type="password" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-unlock-error" : undefined} required /><FormFieldError id="account-unlock-error" errors={field.state.meta.errors} /></>}
        </unlockForm.Field>
        <unlockForm.Subscribe selector={(formState) => formState.isSubmitting}>
          {(isSubmitting) => <button className="primary-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Membuka brankas…" : "Lanjutkan"}</button>}
        </unlockForm.Subscribe>
        {message && <p className="form-status" role="alert">{message}</p>}
      </form>
    );
  }

  const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
  return (
    <>
      {!online && <p className="offline-notice" role="status">Luring: akun baru tidak dapat disimpan.</p>}
      <QrImportInput onUri={(uri) => accountForm.setFieldValue("uri", uri)} />
      <form noValidate className="auth-form add-account-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void accountForm.handleSubmit(); }}>
        <accountForm.Field name="selectedVaultId" validators={{ onSubmit: requiredText("Brankas tujuan") }}>
          {(field) => <><label htmlFor="account-target-vault">Simpan ke brankas</label><select id="account-target-vault" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-target-vault-error" : undefined} required>{writableVaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}</select><FormFieldError id="account-target-vault-error" errors={field.state.meta.errors} /></>}
        </accountForm.Field>
        <accountForm.Field name="uri" validators={{ onSubmit: requiredText("URI autentikator") }}>
          {(field) => <><label htmlFor="account-uri">URI autentikator</label><input id="account-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} placeholder="otpauth://totp/…" autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-uri-error" : undefined} required disabled={!online} /><FormFieldError id="account-uri-error" errors={field.state.meta.errors} /></>}
        </accountForm.Field>
        <div className="form-actions">
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

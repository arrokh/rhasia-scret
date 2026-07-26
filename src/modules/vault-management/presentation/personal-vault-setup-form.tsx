"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { generateVaultUnlockSecret, initializePersonalVaultInBrowser, validateVaultUnlockSecret } from "@/modules/crypto";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { useInitializePersonalVaultMutation } from "./hooks/use-personal-vault-mutations";

type SecretMode = "generated" | "custom";
type SetupStatus = "idle" | "setup_error";

export function PersonalVaultSetupForm() {
  const router = useRouter();
  const generatedSecret = useRef<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [status, setStatus] = useState<SetupStatus>("idle");
  const initializeMutation = useInitializePersonalVaultMutation();
  const form = useForm({
    defaultValues: {
      vaultName: "Brankas Pribadi",
      secretMode: "generated" as SecretMode,
      secret: "",
      confirmation: "",
      acknowledged: false
    },
    onSubmit: async ({ value }) => {
      setStatus("idle");
      try {
        const material = await initializePersonalVaultInBrowser(value.secret, value.vaultName);
        await initializeMutation.mutateAsync({
          vaultUnlockSalt: bytesToBase64(material.vaultUnlockSalt),
          wrappedUserRootKey: bytesToBase64(material.wrappedUserRootKey),
          encryptedPersonalVaultKey: bytesToBase64(material.encryptedPersonalVaultKey),
          encryptedVaultName: bytesToBase64(material.encryptedVaultName),
          encryptionVersion: material.encryptionVersion
        });
        router.refresh();
      } catch {
        setStatus("setup_error");
      }
    }
  });

  useEffect(() => {
    generatedSecret.current ??= generateVaultUnlockSecret();
    form.setFieldValue("secret", generatedSecret.current);
  }, [form]);

  function selectSecretMode(mode: SecretMode) {
    form.setFieldValue("secretMode", mode);
    form.setFieldValue("secret", mode === "generated" ? (generatedSecret.current ?? "") : "");
    form.setFieldValue("confirmation", "");
    setSecretVisible(false);
    setConfirmationVisible(false);
    setStatus("idle");
  }

  function regenerateSecret() {
    const nextSecret = generateVaultUnlockSecret();
    generatedSecret.current = nextSecret;
    form.setFieldValue("secret", nextSecret);
    form.setFieldValue("confirmation", "");
    setStatus("idle");
  }

  return (
    <form noValidate className="auth-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Field name="vaultName" validators={{ onSubmit: requiredText("Nama Brankas") }}>
        {(field) => <><label htmlFor="vault-name">Nama Brankas</label><input id="vault-name" name={field.name} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "vault-name-error" : undefined} required /><FormFieldError id="vault-name-error" errors={field.state.meta.errors} /></>}
      </form.Field>
      <form.Field name="secretMode">
        {(modeField) => (
          <>
            <fieldset className="passphrase-options">
              <legend>Pilih Passphrase Brankas</legend>
              <label className="radio-label"><input type="radio" name={modeField.name} checked={modeField.state.value === "generated"} onChange={() => selectSecretMode("generated")} /><span>Dibuatkan secara acak (direkomendasikan)</span></label>
              <label className="radio-label"><input type="radio" name={modeField.name} checked={modeField.state.value === "custom"} onChange={() => selectSecretMode("custom")} /><span>Buat Passphrase Brankas sendiri</span></label>
            </fieldset>
            <form.Field
              name="secret"
              validators={{
                onSubmit: ({ value }) => validateSecret(value)
              }}
            >
              {(secretField) => modeField.state.value === "generated" ? (
                <>
                  <p>Passphrase Brankas dibuat di browser ini. Simpan secara luring sebelum melanjutkan.</p>
                  <output className="generated-passphrase" aria-label="Passphrase Brankas">{secretField.state.value || "Membuat passphrase…"}</output>
                  <button className="secondary-button" type="button" disabled={!secretField.state.value} onClick={regenerateSecret}>Buat passphrase lain</button>
                  <FormFieldError id="generated-secret-error" errors={secretField.state.meta.errors} />
                </>
              ) : (
                <>
                  <label htmlFor="custom-unlock-secret">Passphrase Brankas Anda</label>
                  <PasswordField
                    id="custom-unlock-secret"
                    label="Passphrase Brankas Anda"
                    value={secretField.state.value}
                    visible={secretVisible}
                    onChange={(value) => {
                      secretField.handleChange(value);
                      if (form.state.values.confirmation) form.setFieldValue("confirmation", "");
                      setStatus("idle");
                    }}
                    onToggleVisibility={() => setSecretVisible((visible) => !visible)}
                    invalid={secretField.state.meta.errors.length > 0}
                    describedBy={secretField.state.meta.errors.length ? "custom-secret-error" : "custom-secret-guidance"}
                  />
                  <p id="custom-secret-guidance">Gunakan minimal 3 karakter. Pilih passphrase yang sulit ditebak dan unik untuk brankas ini.</p>
                  <FormFieldError id="custom-secret-error" errors={secretField.state.meta.errors} />
                </>
              )}
            </form.Field>
          </>
        )}
      </form.Field>
      <form.Field
        name="confirmation"
        validators={{
          onChange: ({ value }) => value && value !== form.state.values.secret ? "Konfirmasi Passphrase Brankas tidak cocok dengan Passphrase Brankas Anda." : undefined,
          onSubmit: ({ value }) => value === form.state.values.secret ? undefined : "Konfirmasi Passphrase Brankas tidak cocok dengan Passphrase Brankas Anda."
        }}
      >
        {(field) => (
          <>
            <label htmlFor="unlock-secret-confirmation">Masukkan kembali Passphrase Brankas</label>
            <PasswordField
              id="unlock-secret-confirmation"
              label="Konfirmasi Passphrase Brankas"
              value={field.state.value}
              visible={confirmationVisible}
              onChange={(value) => { field.handleChange(value); setStatus("idle"); }}
              onToggleVisibility={() => setConfirmationVisible((visible) => !visible)}
              invalid={field.state.meta.errors.length > 0}
              describedBy={field.state.meta.errors.length ? "confirmation-error" : undefined}
            />
            <FormFieldError id="confirmation-error" errors={field.state.meta.errors} />
          </>
        )}
      </form.Field>
      <form.Field name="acknowledged" validators={{ onSubmit: ({ value }) => value ? undefined : "Konfirmasikan bahwa Anda memahami batas pemulihan passphrase." }}>
        {(field) => <><label className="checkbox-label"><input type="checkbox" checked={field.state.value} onChange={(event) => field.handleChange(event.target.checked)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "setup-acknowledgement-error" : undefined} required /> <span>Saya memahami bahwa tanpa kunci akses pemulihan, Passphrase Brankas ini tidak dapat dipulihkan.</span></label><FormFieldError id="setup-acknowledgement-error" errors={field.state.meta.errors} /></>}
      </form.Field>
      <form.Subscribe selector={(formState) => ({ isSubmitting: formState.isSubmitting, secret: formState.values.secret, mode: formState.values.secretMode })}>
        {({ isSubmitting, secret, mode }) => <button className="primary-button" type="submit" disabled={(mode === "generated" && !secret) || isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Mengamankan Brankas…" : "Amankan Brankas Pribadi"}</button>}
      </form.Subscribe>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => isSubmitting ? <p className="form-status" role="status">Kunci sedang dibuat di browser ini. Proses ini dapat memerlukan beberapa detik.</p> : null}
      </form.Subscribe>
      {status === "setup_error" && <p className="form-status" role="alert">Brankas tidak dapat diamankan. Coba lagi. Tidak ada rahasia yang dikirim ke server.</p>}
    </form>
  );
}

function validateSecret(secret: string): string | undefined {
  try {
    validateVaultUnlockSecret(secret);
    return undefined;
  } catch {
    return "Passphrase Brankas harus berisi minimal 3 karakter.";
  }
}

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
  invalid?: boolean;
  describedBy?: string;
};

function PasswordField({ id, label, value, visible, onChange, onToggleVisibility, invalid = false, describedBy }: PasswordFieldProps) {
  return (
    <div className="password-field">
      <input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" aria-invalid={invalid} aria-describedby={describedBy} required />
      <button className="password-visibility-button" type="button" onClick={onToggleVisibility} aria-label={`${visible ? "Sembunyikan" : "Tampilkan"} ${label}`} aria-pressed={visible}><EyeIcon hidden={visible} /></button>
    </div>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" />{hidden && <path d="m4 4 16 16" />}</svg>;
}

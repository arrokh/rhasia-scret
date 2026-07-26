"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { usePasskeyRecoveryStatusQuery } from "@/modules/identity";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { loadUnlockedVaultWorkspace, loadUnlockedVaultWorkspaceWithPasskey, type UnlockedVaultWorkspace } from "../infrastructure/browser-vault-workspace";

export function VaultWorkspaceUnlock({ personalVaultId, onUnlocked }: { personalVaultId: string; onUnlocked: (workspace: UnlockedVaultWorkspace) => void }) {
  const [status, setStatus] = useState<"idle" | "secret_error" | "passkey_error">("idle");
  const [passkeyUnlocking, setPasskeyUnlocking] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const recoveryStatus = usePasskeyRecoveryStatusQuery();
  const form = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      setStatus("idle");
      try { onUnlocked(await loadUnlockedVaultWorkspace(value.secret, personalVaultId)); form.reset(); }
      catch { setStatus("secret_error"); }
    }
  });

  async function unlockWithPasskey() {
    setStatus("idle");
    setPasskeyUnlocking(true);
    try { onUnlocked(await loadUnlockedVaultWorkspaceWithPasskey(personalVaultId)); form.reset(); }
    catch { setStatus("passkey_error"); }
    finally { setPasskeyUnlocking(false); }
  }

  return <form noValidate className="grid gap-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <div className="grid justify-items-center gap-3 text-center">
      <span className="grid size-16 place-items-center rounded-xl bg-gold-soft text-ink-strong" aria-hidden="true"><KeyRound className="size-7" /></span>
      <div><h2 className="text-xl font-bold text-ink-strong">Brankas Anda terkunci</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Buka untuk melanjutkan. Passphrase tetap di perangkat ini.</p></div>
    </div>
    <form.Field name="secret" validators={{ onSubmit: requiredText("Passphrase Brankas") }}>
      {(field) => <div className="grid gap-2"><Label htmlFor="vault-unlock-secret">Passphrase Brankas</Label><PasswordInput id="vault-unlock-secret" label="Passphrase Brankas" visible={secretVisible} onToggleVisibility={() => setSecretVisible((visible) => !visible)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "vault-unlock-secret-error" : undefined} disabled={passkeyUnlocking} required autoComplete="current-password" /><FormFieldError id="vault-unlock-secret-error" errors={field.state.meta.errors} /></div>}
    </form.Field>
    <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" className="w-full" disabled={isSubmitting || passkeyUnlocking} aria-busy={isSubmitting}>{isSubmitting ? "Membuka semua brankas…" : "Buka Brankas"}</Button>}</form.Subscribe>
    {recoveryStatus.data?.enrolled && <><div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">atau</div><Button variant="outline" type="button" onClick={() => void unlockWithPasskey()} disabled={passkeyUnlocking} aria-busy={passkeyUnlocking}>{passkeyUnlocking ? <LoaderCircle className="animate-spin" /> : <Fingerprint />}{passkeyUnlocking ? "Memverifikasi passkey…" : "Buka dengan passkey"}</Button></>}
    <Button variant="link" asChild><Link href="/vaults/recovery">Lupa Passphrase Brankas?</Link></Button>
    {status === "secret_error" && <StatusBanner tone="danger" role="alert">Passphrase Brankas tidak dapat membuka brankas Anda.</StatusBanner>}
    {status === "passkey_error" && <StatusBanner tone="danger" role="alert">Passkey tidak dapat membuka brankas. Coba lagi atau gunakan Passphrase Brankas.</StatusBanner>}
  </form>;
}

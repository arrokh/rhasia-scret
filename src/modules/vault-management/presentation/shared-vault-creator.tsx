"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { useCreateSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { createSharedVaultMaterial } from "../infrastructure/browser-shared-vault-creator";

export function SharedVaultCreator({ userRootKey, onCreated, onCancel }: { userRootKey: Uint8Array; onCreated?: (vault: { id: string; name: string; key: Uint8Array }) => void; onCancel?: () => void }) {
  const [status, setStatus] = useState("");
  const online = useOnlineStatus();
  const createMutation = useCreateSharedVaultMutation();
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!online) { setStatus("Anda sedang luring. Pembuatan Brankas Bersama tidak tersedia hingga Anda tersambung kembali."); return; }
      try {
        const material = await createSharedVaultMaterial(userRootKey, value.name);
        const created = await createMutation.mutateAsync({ encryptedName: bytesToBase64(material.encryptedName), encryptedOwnerVaultKey: bytesToBase64(material.encryptedOwnerVaultKey), encryptionVersion: material.encryptionVersion });
        const createdName = value.name.trim(); form.reset(); setStatus("Brankas Bersama dibuat. Undang anggota dari pengaturannya."); onCreated?.({ id: created.id, name: createdName, key: material.vaultKey });
      } catch { setStatus("Tidak dapat membuat Brankas Bersama."); }
    }
  });

  return <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
    <form.Field name="name" validators={{ onSubmit: requiredText("Nama Brankas Bersama") }}>{(field) => <div className="grid gap-2"><Label htmlFor="shared-vault-name">Nama Brankas Bersama</Label><Input id="shared-vault-name" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "shared-vault-name-error" : undefined} required disabled={!online} autoFocus /><FormFieldError id="shared-vault-name-error" errors={field.state.meta.errors} /></div>}</form.Field>
    {!online && <StatusBanner tone="offline">Perubahan diblokir dan tidak pernah diantrikan.</StatusBanner>}
    {status && <StatusBanner tone={status.includes("dibuat") ? "success" : "danger"} role={status.includes("dibuat") ? "status" : "alert"}>{status}</StatusBanner>}
    <div className="grid grid-cols-2 gap-2">{onCancel && <Button variant="outline" type="button" onClick={onCancel}>Batal</Button>}<form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={!online || isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Membuat…" : "Buat Brankas"}</Button>}</form.Subscribe></div>
  </form>;
}

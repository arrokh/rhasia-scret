"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { useCreateSharedVaultMutation } from "./hooks/use-shared-vault-mutations";
import { createSharedVaultMaterial } from "../infrastructure/browser-shared-vault-creator";

export function SharedVaultCreator({
  userRootKey,
  onCreated,
}: {
  userRootKey: Uint8Array;
  onCreated?: (vault: { id: string; name: string; key: Uint8Array }) => void;
}) {
  const t = useTranslations("VaultManagement.creator");
  const [status, setStatus] = useState<"offlineError" | "success" | "error" | null>(null);
  const online = useOnlineStatus();
  const createMutation = useCreateSharedVaultMutation();
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!online) {
        setStatus("offlineError");
        return;
      }
      try {
        const vaultId = randomOpaqueId();
        const material = await createSharedVaultMaterial(userRootKey, value.name, vaultId);
        const created = await createMutation.mutateAsync({
          vaultId,
          encryptedName: bytesToBase64(material.encryptedName),
          encryptedOwnerVaultKey: bytesToBase64(material.encryptedOwnerVaultKey),
          encryptionVersion: material.encryptionVersion,
        });
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultCreated);
        const createdName = value.name.trim();
        form.reset();
        setStatus("success");
        onCreated?.({ id: created.id, name: createdName, key: material.vaultKey });
      } catch {
        captureAnalyticsEvent(ANALYTICS_EVENTS.sharedVaultCreationFailed);
        setStatus("error");
      }
    },
  });

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("required")) }}>
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="shared-vault-name">{t("name")}</Label>
            <Input
              id="shared-vault-name"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "shared-vault-name-error" : undefined}
              required
              disabled={!online}
              autoFocus
            />
            <FormFieldError id="shared-vault-name-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {!online && <StatusBanner tone="offline">{t("offline")}</StatusBanner>}
      {status && (
        <StatusBanner
          tone={status === "success" ? "success" : "danger"}
          role={status === "success" ? "status" : "alert"}
        >
          {t(status)}
        </StatusBanner>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={!online || isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? t("creating") : t("create")}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function randomOpaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  bytes.fill(0);
  return encoded;
}

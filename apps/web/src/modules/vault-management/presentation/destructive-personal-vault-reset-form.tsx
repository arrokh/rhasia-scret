"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { clearAllOfflineVaultData, requestLocalVaultLock } from "@/modules/sync";
import { DESTRUCTIVE_RESET_CONFIRMATION } from "../application/destructive-personal-vault-reset";
import { useDestructivePersonalVaultResetMutation } from "./hooks/use-personal-vault-mutations";

type Status =
  "idle" | "confirming" | "resetting" | "invalid_confirmation" | "blocked" | "reset_error" | "cleanup_error";

export function DestructivePersonalVaultResetForm() {
  const t = useTranslations("VaultManagement.destructiveReset");
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [blockedVaults, setBlockedVaults] = useState(0);
  const resetMutation = useDestructivePersonalVaultResetMutation();
  const form = useForm({ defaultValues: { confirmation: "" }, onSubmit: () => setStatus("confirming") });

  async function confirmReset() {
    setStatus("resetting");
    let resetCompleted = false;
    try {
      const result = await resetMutation.mutateAsync(form.state.values.confirmation);
      if (result.status === "invalid_confirmation") {
        setStatus("invalid_confirmation");
        return;
      }
      if (result.status === "owned_shared_vaults_exist") {
        setBlockedVaults(result.count);
        setStatus("blocked");
        return;
      }
      if (result.status === "passkey_recovery_available") {
        router.refresh();
        return;
      }
      resetCompleted = true;
      captureAnalyticsEvent(ANALYTICS_EVENTS.personalVaultResetCompleted);
      requestLocalVaultLock();
      await clearAllOfflineVaultData();
      router.replace("/vaults");
      router.refresh();
    } catch {
      setStatus(resetCompleted ? "cleanup_error" : "reset_error");
    }
  }

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
      <StatusBanner tone="danger" title={t("title")} role="alert">
        <p>{t("intro")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t("account")}</li>
          <li>{t("keys")}</li>
          <li>{t("memberships")}</li>
          <li>{t("services")}</li>
        </ul>
        <p className="mt-2">{t("boundary")}</p>
      </StatusBanner>
      <form.Field
        name="confirmation"
        validators={{
          onSubmit: ({ value }) => (value === DESTRUCTIVE_RESET_CONFIRMATION ? undefined : t("confirmationMismatch")),
        }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="destructive-reset-confirmation" className="block leading-5">
              {t.rich("typeToken", { token: () => <strong>{DESTRUCTIVE_RESET_CONFIRMATION}</strong> })}
            </Label>
            <Input
              id="destructive-reset-confirmation"
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
                if (status !== "resetting") setStatus("idle");
              }}
              autoComplete="off"
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "destructive-reset-confirmation-error" : undefined}
              disabled={status === "resetting"}
              required
            />
            <FormFieldError id="destructive-reset-confirmation-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button variant="destructive" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            <Trash2 />
            {isSubmitting ? t("deleting") : t("submit")}
          </Button>
        )}
      </form.Subscribe>
      {status === "invalid_confirmation" && (
        <StatusBanner tone="danger" role="alert">
          {t("invalid")}
        </StatusBanner>
      )}
      {status === "blocked" && (
        <StatusBanner tone="danger" role="alert">
          {t("blocked", { count: blockedVaults })}
        </StatusBanner>
      )}
      {status === "reset_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("error")}
        </StatusBanner>
      )}
      {status === "cleanup_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("cleanupError")}
        </StatusBanner>
      )}
      {status === "confirming" && (
        <ConfirmationDialog
          title={t("confirmTitle")}
          description={t("confirmDescription")}
          confirmLabel={t("confirm")}
          danger
          onCancel={() => setStatus("idle")}
          onConfirm={() => void confirmReset()}
        />
      )}
    </form>
  );
}

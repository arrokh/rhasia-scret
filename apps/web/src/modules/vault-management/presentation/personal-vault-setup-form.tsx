"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "@tanstack/react-form";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  generateVaultUnlockSecret,
  initializePersonalVaultInBrowser,
  validateVaultUnlockSecret,
} from "@/modules/crypto";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { useInitializePersonalVaultMutation } from "./hooks/use-personal-vault-mutations";

type SecretMode = "generated" | "custom";
type SetupStatus = "idle" | "setup_error";

export function PersonalVaultSetupForm() {
  const t = useTranslations("VaultManagement.setup");
  const router = useRouter();
  const generatedSecret = useRef<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [status, setStatus] = useState<SetupStatus>("idle");
  const initializeMutation = useInitializePersonalVaultMutation();
  const form = useForm({
    defaultValues: {
      vaultName: t("defaultVaultName"),
      secretMode: "generated" as SecretMode,
      secret: "",
      confirmation: "",
      acknowledged: false,
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
          encryptionVersion: material.encryptionVersion,
        });
        captureAnalyticsEvent(ANALYTICS_EVENTS.personalVaultInitialized);
        router.refresh();
      } catch {
        captureAnalyticsEvent(ANALYTICS_EVENTS.personalVaultInitializationFailed);
        setStatus("setup_error");
      }
    },
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
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="vaultName"
        validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("vaultNameRequired")) }}
      >
        {(field) => (
          <Field>
            <Label htmlFor="vault-name">{t("vaultName")}</Label>
            <Input
              id="vault-name"
              name={field.name}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "vault-name-error" : undefined}
              required
            />
            <FormFieldError id="vault-name-error" errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Field name="secretMode">
        {(modeField) => (
          <Field>
            <Label>{t("choosePassphrase")}</Label>
            <RadioGroup
              value={modeField.state.value}
              onValueChange={(value) => selectSecretMode(value as SecretMode)}
              className="grid gap-2"
            >
              <Choice
                id="generated-secret"
                value="generated"
                title={t("generatedTitle")}
                description={t("generatedDescription")}
              />
              <Choice id="custom-secret" value="custom" title={t("customTitle")} description={t("customDescription")} />
            </RadioGroup>
            <form.Field
              name="secret"
              validators={{ onSubmit: ({ value }) => validateSecret(value, t("passphraseInvalid")) }}
            >
              {(secretField) =>
                modeField.state.value === "generated" ? (
                  <div className="grid gap-3 rounded-lg border border-warning/25 bg-warning-surface p-4">
                    <p className="text-sm leading-5 text-warning">{t("generatedWarning")}</p>
                    <output
                      className="rounded-md border border-warning/20 bg-card p-3 text-center font-mono text-sm leading-6 font-bold text-foreground break-words"
                      aria-label={t("vaultPassphrase")}
                    >
                      {secretField.state.value || t("generating")}
                    </output>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={!secretField.state.value}
                      onClick={regenerateSecret}
                    >
                      <RefreshCw aria-hidden="true" />
                      {t("regenerate")}
                    </Button>
                    <FormFieldError id="generated-secret-error" errors={secretField.state.meta.errors} />
                  </div>
                ) : (
                  <Field>
                    <Label htmlFor="custom-unlock-secret">{t("yourPassphrase")}</Label>
                    <PasswordInput
                      id="custom-unlock-secret"
                      label={t("yourPassphrase")}
                      value={secretField.state.value}
                      visible={secretVisible}
                      onChange={(event) => {
                        secretField.handleChange(event.target.value);
                        if (form.state.values.confirmation) form.setFieldValue("confirmation", "");
                        setStatus("idle");
                      }}
                      onToggleVisibility={() => setSecretVisible((visible) => !visible)}
                      aria-invalid={secretField.state.meta.errors.length > 0}
                      aria-describedby={
                        secretField.state.meta.errors.length ? "custom-secret-error" : "custom-secret-guidance"
                      }
                      autoComplete="new-password"
                      required
                    />
                    <p id="custom-secret-guidance" className="text-xs leading-5 text-muted-foreground">
                      {t("customGuidance")}
                    </p>
                    <FormFieldError id="custom-secret-error" errors={secretField.state.meta.errors} />
                  </Field>
                )
              }
            </form.Field>
          </Field>
        )}
      </form.Field>

      <form.Field
        name="confirmation"
        validators={{
          onChange: ({ value }) =>
            value && value !== form.state.values.secret ? t("confirmationMismatch") : undefined,
          onSubmit: ({ value }) => (value === form.state.values.secret ? undefined : t("confirmationMismatch")),
        }}
      >
        {(field) => (
          <Field>
            <Label htmlFor="unlock-secret-confirmation">{t("reenter")}</Label>
            <PasswordInput
              id="unlock-secret-confirmation"
              label={t("confirmation")}
              value={field.state.value}
              visible={confirmationVisible}
              onChange={(event) => {
                field.handleChange(event.target.value);
                setStatus("idle");
              }}
              onToggleVisibility={() => setConfirmationVisible((visible) => !visible)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "confirmation-error" : undefined}
              autoComplete="new-password"
              required
            />
            <FormFieldError id="confirmation-error" errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Field
        name="acknowledged"
        validators={{ onSubmit: ({ value }) => (value ? undefined : t("acknowledgementRequired")) }}
      >
        {(field) => (
          <Field>
            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 p-3">
              <Checkbox
                id="setup-acknowledgement"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={field.state.meta.errors.length ? "setup-acknowledgement-error" : undefined}
              />
              <Label htmlFor="setup-acknowledgement" className="text-sm leading-5 font-normal">
                {t("acknowledgement")}
              </Label>
            </div>
            <FormFieldError id="setup-acknowledgement-error" errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => ({
          isSubmitting: state.isSubmitting,
          secret: state.values.secret,
          mode: state.values.secretMode,
        })}
      >
        {({ isSubmitting, secret, mode }) => (
          <Button
            type="submit"
            className="w-full"
            disabled={(mode === "generated" && !secret) || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting && <LoaderCircle className="animate-spin" />}
            {isSubmitting ? t("securing") : t("secure")}
          </Button>
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (isSubmitting ? <StatusBanner tone="info">{t("creatingKeys")}</StatusBanner> : null)}
      </form.Subscribe>
      {status === "setup_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("error")}
        </StatusBanner>
      )}
    </form>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2">{children}</div>;
}

function Choice({
  id,
  value,
  title,
  description,
}: {
  id: string;
  value: SecretMode;
  title: string;
  description: string;
}) {
  return (
    <Label
      htmlFor={id}
      className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 font-normal has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-warning-surface"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span>
        <strong className="block text-sm text-foreground">{title}</strong>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}

function validateSecret(secret: string, invalidMessage: string): string | undefined {
  try {
    validateVaultUnlockSecret(secret);
    return undefined;
  } catch {
    return invalidMessage;
  }
}

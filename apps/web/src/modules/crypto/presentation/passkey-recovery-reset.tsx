"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { Check, Copy, Fingerprint, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { validateVaultUnlockSecret } from "../infrastructure/browser-vault-unlock-key";
import { resetVaultUnlockSecretWithPasskey } from "../infrastructure/browser-passkey-recovery-workflow";
import { generateVaultUnlockSecret } from "./generate-vault-unlock-secret";
import { browserClipboard } from "@/shared/infrastructure/browser-platform-ports";

type Status = "idle" | "recovering" | "recovery_error" | "success";
type SecretMode = "generated" | "custom";
type CopyStatus = "idle" | "copied" | "error";

export function PasskeyRecoveryReset() {
  const t = useTranslations("Crypto.passkeyReset");
  const router = useRouter();
  const generatedSecret = useRef<string | null>(null);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [customSecretVisible, setCustomSecretVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const form = useForm({
    defaultValues: { mode: "generated" as SecretMode, customSecret: "", confirmation: "", acknowledged: false },
    onSubmit: async ({ value }) => reset(value.mode === "generated" ? secret : value.customSecret, value.confirmation),
  });

  useEffect(() => {
    generatedSecret.current ??= generateVaultUnlockSecret();
    setSecret(generatedSecret.current);
  }, []);
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  function selectMode(mode: SecretMode) {
    form.setFieldValue("mode", mode);
    form.setFieldValue("customSecret", "");
    form.setFieldValue("confirmation", "");
    form.setFieldValue("acknowledged", false);
    setCopyStatus("idle");
    setStatus("idle");
  }

  function regenerateSecret() {
    const nextSecret = generateVaultUnlockSecret();
    generatedSecret.current = nextSecret;
    setSecret(nextSecret);
    form.setFieldValue("confirmation", "");
    form.setFieldValue("acknowledged", false);
    setCopyStatus("idle");
    setStatus("idle");
  }

  async function copyGeneratedSecret() {
    if (!secret) return;
    try {
      await browserClipboard.writeText(secret);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  async function reset(nextSecret: string, confirmation: string) {
    if (!nextSecret || confirmation.trim() !== nextSecret.trim()) return;
    setStatus("recovering");
    try {
      await resetVaultUnlockSecretWithPasskey(nextSecret.trim());
      captureAnalyticsEvent(ANALYTICS_EVENTS.passkeyRecoveryResetCompleted);
      setStatus("success");
      router.replace("/vaults");
    } catch {
      setStatus("recovery_error");
    }
  }

  const unavailable = status === "recovering" || status === "success";
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
      <SectionHeading icon={Fingerprint} title={t("title")} description={t("description")} />

      <form.Field name="mode">
        {(field) => (
          <div className="grid gap-2">
            <Label>{t("choose")}</Label>
            <RadioGroup
              value={field.state.value}
              onValueChange={(value) => selectMode(value as SecretMode)}
              disabled={unavailable}
              className="grid gap-2 sm:grid-cols-2"
            >
              <PassphraseChoice
                id="recovery-generated-mode"
                value="generated"
                title={t("generated")}
                description={t("recommended")}
              />
              <PassphraseChoice
                id="recovery-custom-mode"
                value="custom"
                title={t("custom")}
                description={t("minimum")}
              />
            </RadioGroup>
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.mode}>
        {(mode) =>
          mode === "generated" ? (
            <div className="grid gap-3">
              <Label htmlFor="recovery-new-secret">{t("newPassphrase")}</Label>
              <output
                id="recovery-new-secret"
                className="rounded-md border border-warning/25 bg-warning-surface p-3 text-center font-mono text-sm leading-6 font-bold break-words"
                aria-label={t("newPassphrase")}
              >
                {secret || t("generating")}
              </output>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={!secret || status === "recovering"}
                  onClick={() => void copyGeneratedSecret()}
                >
                  {copyStatus === "copied" ? <Check /> : <Copy />}
                  {copyStatus === "copied" ? t("copied") : t("copy")}
                </Button>
                <Button variant="outline" type="button" disabled={!secret || unavailable} onClick={regenerateSecret}>
                  <RefreshCw />
                  {t("regenerate")}
                </Button>
              </div>
              {copyStatus === "error" && (
                <StatusBanner tone="danger" role="alert">
                  {t("copyError")}
                </StatusBanner>
              )}
              <span className="sr-only" aria-live="polite">
                {copyStatus === "copied" ? t("copiedAnnouncement") : ""}
              </span>
            </div>
          ) : (
            <form.Field
              name="customSecret"
              validators={{ onSubmit: ({ value }) => validateCustomSecret(value, t("invalid")) }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="recovery-custom-secret">{t("newPassphrase")}</Label>
                  <PasswordInput
                    id="recovery-custom-secret"
                    label={t("newPassphrase")}
                    visible={customSecretVisible}
                    onToggleVisibility={() => setCustomSecretVisible((visible) => !visible)}
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      form.setFieldValue("confirmation", "");
                      setStatus("idle");
                    }}
                    autoComplete="new-password"
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length ? "recovery-custom-secret-error" : "recovery-custom-secret-help"
                    }
                    disabled={unavailable}
                    required
                  />
                  <p id="recovery-custom-secret-help" className="text-xs leading-5 text-muted-foreground">
                    {t("customHelp")}
                  </p>
                  <FormFieldError id="recovery-custom-secret-error" errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          )
        }
      </form.Subscribe>

      <form.Field
        name="confirmation"
        validators={{
          onSubmit: ({ value }) =>
            value.trim() === currentSecret(form.state.values.mode, secret, form.state.values.customSecret).trim()
              ? undefined
              : t("confirmationMismatch"),
        }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="recovery-secret-confirmation">{t("reenter")}</Label>
            <PasswordInput
              id="recovery-secret-confirmation"
              label={t("confirmation")}
              visible={confirmationVisible}
              onToggleVisibility={() => setConfirmationVisible((visible) => !visible)}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              autoComplete="new-password"
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "recovery-confirmation-error" : undefined}
              disabled={unavailable}
              required
            />
            <FormFieldError id="recovery-confirmation-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field
        name="acknowledged"
        validators={{ onSubmit: ({ value }) => (value ? undefined : t("acknowledgementRequired")) }}
      >
        {(field) => (
          <div className="grid gap-2">
            <div className="flex items-start gap-3 rounded-md border bg-muted/50 p-3">
              <Checkbox
                id="recovery-acknowledgement"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={field.state.meta.errors.length ? "recovery-acknowledgement-error" : undefined}
                disabled={unavailable}
              />
              <Label htmlFor="recovery-acknowledgement" className="text-sm leading-5 font-normal">
                {t("acknowledgement")}
              </Label>
            </div>
            <FormFieldError id="recovery-acknowledgement-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          isSubmitting: state.isSubmitting,
          mode: state.values.mode,
          customSecret: state.values.customSecret,
        })}
      >
        {({ isSubmitting, mode, customSecret }) => (
          <Button
            type="submit"
            disabled={!(mode === "generated" ? secret : customSecret.trim()) || isSubmitting || status === "success"}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? t("verifying") : t("submit")}
          </Button>
        )}
      </form.Subscribe>
      {status === "recovery_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("error")}
        </StatusBanner>
      )}
      {status === "success" && <StatusBanner tone="success">{t("success")}</StatusBanner>}
    </form>
  );
}

function PassphraseChoice({
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
      className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md border bg-card p-3 font-normal has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-warning-surface"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span>
        <strong className="block text-sm text-foreground">{title}</strong>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}

function currentSecret(mode: SecretMode, generatedSecret: string, customSecret: string): string {
  return mode === "generated" ? generatedSecret : customSecret;
}
function validateCustomSecret(secret: string, invalidMessage: string): string | undefined {
  try {
    validateVaultUnlockSecret(secret);
    return undefined;
  } catch {
    return invalidMessage;
  }
}

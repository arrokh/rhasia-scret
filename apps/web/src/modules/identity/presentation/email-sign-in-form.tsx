"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { createBrowserSupabaseClient } from "./browser-supabase-client";
import { authConfirmationRedirectUrl, requestEmailSignInLink } from "./request-email-sign-in-link";

export function EmailSignInForm() {
  const t = useTranslations("Identity.signIn");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "rate_limited">("idle");
  const [retrySeconds, setRetrySeconds] = useState(0);
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      if (retrySeconds > 0) return;
      setStatus("sending");
      const result = await requestEmailSignInLink(createBrowserSupabaseClient(), value.email, authConfirmationRedirectUrl(window.location.origin));
      if (result === "rate_limited") setRetrySeconds(60);
      setStatus(result);
    }
  });

  useEffect(() => {
    if (retrySeconds === 0) return;
    const timer = window.setTimeout(() => setRetrySeconds((seconds) => seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  return (
    <form noValidate className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Field name="email" validators={{ onBlur: ({ value }) => validateEmail(value, t("emailRequired"), t("emailInvalid")), onSubmit: ({ value }) => validateEmail(value, t("emailRequired"), t("emailInvalid")) }}>
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="email" className="sr-only">{t("emailLabel")}</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="email" name={field.name} className="pl-10" type="email" autoComplete="email" placeholder={t("emailPlaceholder")} required value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "email-error" : "email-description"} />
            </div>
            <FormFieldError id="email-error" errors={field.state.meta.errors} />
            <p id="email-description" className="text-xs leading-5 text-muted-foreground">{t("emailDescription")}</p>
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => (
          <Button
            type={status === "sent" ? "button" : "submit"}
            variant={status === "sent" ? "ghost" : "default"}
            className="w-full"
            disabled={isSubmitting || retrySeconds > 0}
            aria-busy={isSubmitting}
            onClick={status === "sent" ? () => window.location.reload() : undefined}
          >
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {isSubmitting ? t("sending") : status === "sent" ? t("retryPage") : retrySeconds > 0 ? t("retryIn", { seconds: retrySeconds }) : t("sendLink")}
          </Button>
        )}
      </form.Subscribe>
      {status === "sent" && <StatusBanner tone="success">{t("sent")}</StatusBanner>}
      {status === "rate_limited" && <StatusBanner tone="warning">{t("rateLimited")}</StatusBanner>}
      {status === "error" && <StatusBanner tone="danger" role="alert">{t("error")}</StatusBanner>}
    </form>
  );
}

function validateEmail(value: string, requiredMessage: string, invalidMessage: string): string | undefined {
  if (!value.trim()) return requiredMessage;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : invalidMessage;
}

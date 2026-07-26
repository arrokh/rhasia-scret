"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { createBrowserSupabaseClient } from "./browser-supabase-client";
import { requestInvitedSignInLink } from "./request-invited-sign-in-link";

export function InvitedUserSignInForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "rate_limited">("idle");
  const [retrySeconds, setRetrySeconds] = useState(0);
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      if (retrySeconds > 0) return;
      setStatus("sending");
      const result = await requestInvitedSignInLink(
        createBrowserSupabaseClient(),
        value.email,
        `${window.location.origin}/auth/confirm`
      );
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
    <form noValidate className="auth-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => validateEmail(value),
          onSubmit: ({ value }) => validateEmail(value)
        }}
      >
        {(field) => (
          <>
            <label htmlFor="email">Alamat email yang diundang</label>
            <input
              id="email"
              name={field.name}
              type="email"
              autoComplete="email"
              required
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "email-error" : undefined}
            />
            <FormFieldError id="email-error" errors={field.state.meta.errors} />
          </>
        )}
      </form.Field>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => (
          <button className="primary-button" type="submit" disabled={isSubmitting || retrySeconds > 0}>
            {isSubmitting ? "Mengirim…" : retrySeconds > 0 ? `Coba lagi dalam ${retrySeconds} dtk` : "Kirim tautan masuk"}
          </button>
        )}
      </form.Subscribe>
      <p className="form-status" aria-live="polite">
        {status === "sent" && "Jika alamat ini diundang, periksa kotak masuknya untuk tautan masuk."}
        {status === "rate_limited" && "Terlalu banyak permintaan masuk. Tunggu satu menit, lalu periksa kotak masuk atau coba lagi."}
        {status === "error" && "Kami tidak dapat mengirim tautan masuk. Pastikan alamat ini diundang, lalu coba lagi."}
      </p>
    </form>
  );
}

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Alamat email wajib diisi.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : "Masukkan alamat email yang valid.";
}

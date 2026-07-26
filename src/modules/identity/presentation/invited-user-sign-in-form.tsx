"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { StatusBanner } from "@/shared/presentation/app-ui";
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
      const result = await requestInvitedSignInLink(createBrowserSupabaseClient(), value.email, `${window.location.origin}/auth/confirm`);
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
      <form.Field name="email" validators={{ onBlur: ({ value }) => validateEmail(value), onSubmit: ({ value }) => validateEmail(value) }}>
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="email">Alamat email yang diundang</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="email" name={field.name} className="pl-10" type="email" autoComplete="email" placeholder="nama@keluarga.id" required value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "email-error" : undefined} />
            </div>
            <FormFieldError id="email-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(formState) => formState.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="w-full" disabled={isSubmitting || retrySeconds > 0} aria-busy={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {isSubmitting ? "Mengirim…" : retrySeconds > 0 ? `Coba lagi dalam ${retrySeconds} dtk` : "Kirim tautan masuk"}
          </Button>
        )}
      </form.Subscribe>
      {status === "sent" && <StatusBanner tone="success">Jika alamat ini diundang, periksa kotak masuknya untuk tautan masuk.</StatusBanner>}
      {status === "rate_limited" && <StatusBanner tone="warning">Terlalu banyak permintaan masuk. Tunggu satu menit, lalu periksa kotak masuk atau coba lagi.</StatusBanner>}
      {status === "error" && <StatusBanner tone="danger" role="alert">Kami tidak dapat mengirim tautan masuk. Pastikan alamat ini diundang, lalu coba lagi.</StatusBanner>}
    </form>
  );
}

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Alamat email wajib diisi.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : "Masukkan alamat email yang valid.";
}

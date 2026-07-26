"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { FormFieldError, requiredText } from "@/shared/presentation/form-field-error";
import { generateTotp } from "../application/generate-totp";
import { hasClockDrift } from "../domain/clock-drift";
import { parseTotpUri, type TotpConfiguration } from "../domain/totp-configuration";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";
import { useServerTimeQuery } from "./hooks/use-server-time-query";

export function LocalTotpScreen() {
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const serverTime = useServerTimeQuery(configuration !== null);
  const clockDriftWarning = serverTime.data ? hasClockDrift(new Date(), serverTime.data) : false;
  const form = useForm({
    defaultValues: { uri: "" },
    onSubmit: ({ value }) => {
      try {
        setConfiguration(parseTotpUri(value.uri));
        setError("");
      } catch (reason) {
        setConfiguration(null);
        setCode("");
        setError(reason instanceof Error ? reason.message : "URI autentikator tidak valid.");
      }
    }
  });

  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    const update = async () => {
      try {
        const next = await generateTotp(configuration, new BrowserHmacGenerator());
        if (cancelled) return;
        setCode(next.value);
        setSeconds(Math.max(0, Math.ceil((next.validUntil.getTime() - Date.now()) / 1_000)));
      } catch {
        if (!cancelled) setError("Tidak dapat membuat OTP di browser ini.");
      }
    };
    void update();
    const interval = window.setInterval(() => { void update(); }, 1_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [configuration]);

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="totp-title">
        <h1 id="totp-title">TOTP Lokal</h1>
        <p>Tempel URI TOTP yang didukung. URI diproses dan hanya digunakan di browser ini.</p>
        <form noValidate className="auth-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
          <form.Field name="uri" validators={{ onSubmit: requiredText("URI autentikator") }}>
            {(field) => <><label htmlFor="totp-uri">URI autentikator</label><input id="totp-uri" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "totp-uri-error" : undefined} required /><FormFieldError id="totp-uri-error" errors={field.state.meta.errors} /></>}
          </form.Field>
          <form.Subscribe selector={(formState) => formState.isSubmitting}>
            {(isSubmitting) => <button className="primary-button" type="submit" disabled={isSubmitting}>Buat kode</button>}
          </form.Subscribe>
        </form>
        {error && <p className="form-status" role="alert">{error}</p>}
        {clockDriftWarning && <p className="form-status" role="alert">Waktu perangkat Anda berbeda lebih dari 30 detik dari server. Kode mungkin gagal.</p>}
        {configuration && <section aria-live="polite"><h2>{configuration.issuer}</h2><p>{configuration.accountName}</p><output aria-label="OTP saat ini">{code}</output><p>{seconds} dtk tersisa</p><button className="primary-button" type="button" onClick={() => void copyCode()}>Salin OTP</button></section>}
      </section>
    </main>
  );
}

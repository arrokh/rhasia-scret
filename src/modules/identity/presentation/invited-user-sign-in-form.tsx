"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createBrowserSupabaseClient } from "./browser-supabase-client";
import { requestInvitedSignInLink } from "./request-invited-sign-in-link";

export function InvitedUserSignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "rate_limited">("idle");
  const [retrySeconds, setRetrySeconds] = useState(0);

  useEffect(() => {
    if (retrySeconds === 0) return;
    const timer = window.setTimeout(() => setRetrySeconds((seconds) => seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (retrySeconds > 0) return;
    setStatus("sending");
    const result = await requestInvitedSignInLink(
      createBrowserSupabaseClient(),
      email,
      `${window.location.origin}/auth/confirm`
    );
    if (result === "rate_limited") setRetrySeconds(60);
    setStatus(result);
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="email">Alamat email yang diundang</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button className="primary-button" type="submit" disabled={status === "sending" || retrySeconds > 0}>
        {status === "sending" ? "Mengirim…" : retrySeconds > 0 ? `Coba lagi dalam ${retrySeconds} dtk` : "Kirim tautan masuk"}
      </button>
      <p className="form-status" aria-live="polite">
        {status === "sent" && "Jika alamat ini diundang, periksa kotak masuknya untuk tautan masuk."}
        {status === "rate_limited" && "Terlalu banyak permintaan masuk. Tunggu satu menit, lalu periksa kotak masuk atau coba lagi."}
        {status === "error" && "Kami tidak dapat mengirim tautan masuk. Pastikan alamat ini diundang, lalu coba lagi."}
      </p>
    </form>
  );
}

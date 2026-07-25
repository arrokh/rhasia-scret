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
      <label htmlFor="email">Invited email address</label>
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
        {status === "sending" ? "Sending…" : retrySeconds > 0 ? `Try again in ${retrySeconds}s` : "Send sign-in link"}
      </button>
      <p className="form-status" aria-live="polite">
        {status === "sent" && "If this address is invited, check its inbox for a sign-in link."}
        {status === "rate_limited" && "Too many sign-in requests. Please wait a minute, then check your inbox or try again."}
        {status === "error" && "We could not send a sign-in link. Confirm the address is invited and try again."}
      </p>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { createBrowserSupabaseClient } from "./browser-supabase-client";
import { requestInvitedSignInLink } from "./request-invited-sign-in-link";

export function InvitedUserSignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const sent = await requestInvitedSignInLink(
      createBrowserSupabaseClient(),
      email,
      `${window.location.origin}/auth/confirm`
    );
    setStatus(sent ? "sent" : "error");
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
      <button className="primary-button" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
      <p className="form-status" aria-live="polite">
        {status === "sent" && "If this address is invited, check its inbox for a sign-in link."}
        {status === "error" && "We could not send a sign-in link. Confirm the address is invited and try again."}
      </p>
    </form>
  );
}

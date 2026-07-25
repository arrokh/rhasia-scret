"use client";

import { useEffect, useState } from "react";
import { generateTotp } from "../application/generate-totp";
import { hasClockDrift } from "../domain/clock-drift";
import { parseTotpUri, type TotpConfiguration } from "../domain/totp-configuration";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";

export function LocalTotpScreen() {
  const [uri, setUri] = useState("");
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [clockDriftWarning, setClockDriftWarning] = useState(false);

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
        if (!cancelled) setError("Unable to generate an OTP on this browser.");
      }
    };
    void update();
    const interval = window.setInterval(() => { void update(); }, 1_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [configuration]);

  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    void fetch("/api/time", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ now: string }> : Promise.reject(new Error("time unavailable")))
      .then(({ now }) => { if (!cancelled) setClockDriftWarning(hasClockDrift(new Date(), new Date(now))); })
      .catch(() => { if (!cancelled) setClockDriftWarning(false); });
    return () => { cancelled = true; };
  }, [configuration]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setConfiguration(parseTotpUri(uri));
      setError("");
    } catch (reason) {
      setConfiguration(null);
      setCode("");
      setError(reason instanceof Error ? reason.message : "The authenticator URI is invalid.");
    }
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="totp-title">
        <h1 id="totp-title">Local TOTP</h1>
        <p>Paste a supported TOTP URI. It is parsed and used only in this browser.</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="totp-uri">Authenticator URI</label>
          <input id="totp-uri" value={uri} onChange={(event) => setUri(event.target.value)} autoComplete="off" required />
          <button className="primary-button" type="submit">Generate code</button>
        </form>
        {error && <p className="form-status" role="alert">{error}</p>}
        {clockDriftWarning && <p className="form-status" role="alert">Your device clock differs from the server by more than 30 seconds. Codes may fail.</p>}
        {configuration && <section aria-live="polite"><h2>{configuration.issuer}</h2><p>{configuration.accountName}</p><output aria-label="Current OTP">{code}</output><p>{seconds}s remaining</p><button type="button" onClick={() => void copyCode()}>Copy OTP</button></section>}
      </section>
    </main>
  );
}

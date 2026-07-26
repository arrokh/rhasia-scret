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
        if (!cancelled) setError("Tidak dapat membuat OTP di browser ini.");
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
      setError(reason instanceof Error ? reason.message : "URI autentikator tidak valid.");
    }
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="totp-title">
        <h1 id="totp-title">TOTP Lokal</h1>
        <p>Tempel URI TOTP yang didukung. URI diproses dan hanya digunakan di browser ini.</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="totp-uri">URI autentikator</label>
          <input id="totp-uri" value={uri} onChange={(event) => setUri(event.target.value)} autoComplete="off" required />
          <button className="primary-button" type="submit">Buat kode</button>
        </form>
        {error && <p className="form-status" role="alert">{error}</p>}
        {clockDriftWarning && <p className="form-status" role="alert">Waktu perangkat Anda berbeda lebih dari 30 detik dari server. Kode mungkin gagal.</p>}
        {configuration && <section aria-live="polite"><h2>{configuration.issuer}</h2><p>{configuration.accountName}</p><output aria-label="OTP saat ini">{code}</output><p>{seconds} dtk tersisa</p><button className="primary-button" type="button" onClick={() => void copyCode()}>Salin OTP</button></section>}
      </section>
    </main>
  );
}

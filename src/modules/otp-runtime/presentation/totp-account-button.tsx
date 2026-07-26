"use client";

import { useEffect, useState } from "react";
import type { TotpConfiguration } from "../domain/totp-configuration";
import { generateTotp } from "../application/generate-totp";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";

export function TotpAccountButton({
  configuration,
  vaultName
}: {
  configuration: TotpConfiguration;
  vaultName: string;
}) {
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const next = await generateTotp(configuration, new BrowserHmacGenerator());
        if (!active) return;
        setCode((current) => {
          if (current && current !== next.value) setStatus("idle");
          return next.value;
        });
        setSeconds(Math.max(0, Math.ceil((next.validUntil.getTime() - Date.now()) / 1_000)));
      } catch {
        if (active) setStatus("error");
      }
    };
    void update();
    const interval = window.setInterval(() => { void update(); }, 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [configuration]);

  async function copyOtp() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  const accessibleName = `Salin OTP untuk ${configuration.issuer} ${configuration.accountName}`;
  return (
    <button className="account-totp-button" type="button" onClick={() => void copyOtp()} disabled={!code} aria-label={accessibleName}>
      <span className="account-avatar" aria-hidden="true">{configuration.issuer.slice(0, 1).toUpperCase()}</span>
      <span className="account-copy">
        <strong>{configuration.issuer}</strong>
        <span>{configuration.accountName}</span>
        <small className="vault-badge">{vaultName}</small>
      </span>
      <span className="account-otp" aria-live="polite">
        <span className="otp-code">
          <output aria-label="OTP saat ini">{code ? formatOtp(code) : "••• •••"}</output>
          <small>{status === "copied" ? "Disalin" : status === "error" ? "Tidak tersedia" : "Klik untuk menyalin"}</small>
        </span>
        <span className="otp-timer" aria-label={`${seconds} detik tersisa`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle className="otp-timer-background" cx="18" cy="18" r="15.5" />
            <circle className="otp-timer-progress" cx="18" cy="18" r="15.5" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - timerProgress(seconds, configuration.period)} />
          </svg>
          <small>{seconds}</small>
        </span>
      </span>
    </button>
  );
}

function timerProgress(seconds: number, period: number): number {
  return Math.max(0, Math.min(100, (seconds / period) * 100));
}

function formatOtp(code: string): string {
  const midpoint = Math.ceil(code.length / 2);
  return `${code.slice(0, midpoint)} ${code.slice(midpoint)}`;
}

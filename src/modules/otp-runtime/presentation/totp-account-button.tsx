"use client";

import { useEffect, useRef, useState } from "react";
import type { TotpConfiguration } from "../domain/totp-configuration";
import { generateTotp } from "../application/generate-totp";
import { BrowserHmacGenerator } from "../infrastructure/browser-hmac-generator";

export function TotpAccountButton({
  configuration,
  vaultName,
  onManage
}: {
  configuration: TotpConfiguration;
  vaultName: string;
  onManage?: () => void;
}) {
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const holdTimer = useRef<number | null>(null);
  const suppressCopy = useRef(false);

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
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, [configuration]);

  function startHold() {
    if (!onManage) return;
    suppressCopy.current = false;
    holdTimer.current = window.setTimeout(() => {
      suppressCopy.current = true;
      onManage();
    }, 650);
  }

  function cancelHold() {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  async function copyOtp() {
    cancelHold();
    if (suppressCopy.current) {
      suppressCopy.current = false;
      return;
    }
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  const accessibleName = `Salin OTP untuk ${configuration.accountName}, ${configuration.issuer}`;
  return (
    <button
      className="account-totp-button"
      type="button"
      onClick={() => void copyOtp()}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => {
        if (!onManage) return;
        event.preventDefault();
        onManage();
      }}
      onKeyDown={(event) => {
        if (onManage && event.shiftKey && event.key === "Enter") {
          event.preventDefault();
          onManage();
        }
      }}
      aria-label={accessibleName}
      aria-disabled={!code}
      title={onManage ? "Klik untuk menyalin OTP. Tekan lama untuk mengelola akun." : "Klik untuk menyalin OTP."}
    >
      <span className="account-copy">
        <strong>{configuration.accountName}</strong>
        <span>{configuration.issuer}</span>
      </span>
      <small className="vault-badge">{vaultName}</small>
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

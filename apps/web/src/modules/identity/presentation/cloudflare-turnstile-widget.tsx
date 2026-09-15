"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileWidgetOptions = Readonly<{
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}>;

type TurnstileApi = Readonly<{
  render(container: HTMLElement, options: TurnstileWidgetOptions): string;
  getResponse(widgetId: string): string;
  remove(widgetId: string): void;
}>;

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function CloudflareTurnstileWidget({
  siteKey,
  label,
  onTokenChange,
  onError,
}: Readonly<{
  siteKey?: string;
  label: string;
  onTokenChange: (token: string | null) => void;
  onError: () => void;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onErrorRef = useRef(onError);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
    onErrorRef.current = onError;
  }, [onError, onTokenChange]);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || !window.turnstile) return;
    let widgetId: string | undefined;
    let responseTimer: number | undefined;
    let responseTimeout: number | undefined;
    try {
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenChangeRef.current(token),
        "expired-callback": () => onTokenChangeRef.current(null),
        "error-callback": () => {
          onTokenChangeRef.current(null);
          onErrorRef.current();
        },
      });
      const readResponse = () => {
        if (!widgetId || !window.turnstile) return;
        const token = window.turnstile.getResponse(widgetId);
        if (!token) return;
        if (responseTimer !== undefined) window.clearInterval(responseTimer);
        if (responseTimeout !== undefined) window.clearTimeout(responseTimeout);
        onTokenChangeRef.current(token);
      };
      responseTimer = window.setInterval(readResponse, 250);
      responseTimeout = window.setTimeout(() => {
        if (responseTimer !== undefined) window.clearInterval(responseTimer);
      }, 60_000);
      readResponse();
    } catch {
      onErrorRef.current();
    }
    return () => {
      if (responseTimer !== undefined) window.clearInterval(responseTimer);
      if (responseTimeout !== undefined) window.clearTimeout(responseTimeout);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [scriptReady, siteKey]);

  if (!siteKey) return null;

  return (
    <div className="grid gap-2">
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => onErrorRef.current()}
      />
      <div className="flex justify-center">
        <div ref={containerRef} aria-label={label} />
      </div>
    </div>
  );
}

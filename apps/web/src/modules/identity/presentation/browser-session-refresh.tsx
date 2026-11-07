"use client";

import { useEffect, useRef } from "react";
import { refreshBrowserSessionAssertion } from "../infrastructure/browser-session-client";

const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function BrowserSessionRefresh(): null {
  const initialRefreshStarted = useRef(false);
  useEffect(() => {
    const refresh = () => {
      if (isAuthenticationRoute(window.location.pathname)) return;
      void refreshBrowserSessionAssertion();
    };
    if (!initialRefreshStarted.current) {
      initialRefreshStarted.current = true;
      refresh();
    }
    const interval = window.setInterval(refresh, RENEWAL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return null;
}

function isAuthenticationRoute(pathname: string): boolean {
  return pathname === "/sign-in" || pathname.startsWith("/auth/");
}

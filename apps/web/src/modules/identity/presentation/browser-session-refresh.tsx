"use client";

import { useEffect, useRef } from "react";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export function BrowserSessionRefresh(): null {
  const refreshStarted = useRef(false);
  useEffect(() => {
    if (refreshStarted.current || isAuthenticationRoute(window.location.pathname)) return;
    refreshStarted.current = true;
    void browserApiClient.postJson<{ refreshed: true }>("/api/v1/auth/session/refresh", { client: "web" }).catch(() => {
      // Anonymous pages and expired sessions intentionally remain quiet.
    });
  }, []);
  return null;
}

function isAuthenticationRoute(pathname: string): boolean {
  return pathname === "/sign-in" || pathname.startsWith("/auth/");
}

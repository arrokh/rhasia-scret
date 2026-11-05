"use client";

import { clearAllOfflineVaultData, requestLocalVaultLock } from "@/modules/sync";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { captureAnalyticsEvent, resetAnalytics } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

export async function refreshBrowserSessionAssertion(): Promise<void> {
  try {
    await browserApiClient.postJson<{ refreshed: true }>("/api/v1/auth/session/refresh", { client: "web" });
  } catch {
    // Anonymous pages and expired sessions intentionally remain quiet.
  }
}

export async function terminateBrowserSession(): Promise<string> {
  requestLocalVaultLock();
  await clearAllOfflineVaultData();
  const response = await browserApiClient.post("/auth/logout");
  if (!response.ok) throw new Error("Session termination failed.");
  captureAnalyticsEvent(ANALYTICS_EVENTS.authenticationSignedOut);
  resetAnalytics();
  return response.url || "/sign-in";
}

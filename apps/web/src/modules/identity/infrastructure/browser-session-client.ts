"use client";

import { clearAllOfflineVaultData, requestLocalVaultLock } from "@/modules/sync";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { captureAnalyticsEvent, resetAnalytics } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

export async function terminateBrowserSession(): Promise<string> {
  requestLocalVaultLock();
  await clearAllOfflineVaultData();
  const response = await browserApiClient.post("/auth/logout");
  if (!response.ok) throw new Error("Session termination failed.");
  captureAnalyticsEvent(ANALYTICS_EVENTS.authenticationSignedOut);
  resetAnalytics();
  return response.url || "/sign-in";
}

"use client";

import { clearAllOfflineVaultData, requestLocalVaultLock } from "@/modules/sync";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { resetAnalytics } from "@/shared/infrastructure/browser-analytics";

export async function terminateBrowserSession(): Promise<string> {
  requestLocalVaultLock();
  await clearAllOfflineVaultData();
  const response = await browserApiClient.post("/auth/logout");
  if (!response.ok) throw new Error("Session termination failed.");
  resetAnalytics();
  return response.url || "/sign-in";
}

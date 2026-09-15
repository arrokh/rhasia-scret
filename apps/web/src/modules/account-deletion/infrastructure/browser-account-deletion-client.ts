"use client";

import { clearAccountDirectoryPreferences } from "@/modules/authenticator-account";
import { clearAllOfflineVaultData, requestLocalVaultLock } from "@/modules/sync";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import type { AccountDeletionPreview, AccountDeletionResult } from "../application/account-deletion-repository";
import type { AccountDeletionRequest } from "../domain/account-deletion-policy";

export async function loadAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  return browserApiClient.getJson<AccountDeletionPreview>("/api/me/deletion/preview", { cache: "no-store" });
}

export async function requestAccountDeletionOtp(): Promise<void> {
  await browserApiClient.postEmpty("/api/me/deletion/otp/request");
}

export async function verifyAccountDeletionOtp(otp: string): Promise<void> {
  await browserApiClient.postEmpty("/api/me/deletion/otp/verify", { otp });
}

export async function startAccountDeletionOidcReauthentication(): Promise<void> {
  await browserApiClient.postEmpty("/api/me/deletion/oidc/start");
}

export async function deleteAccount(
  request: AccountDeletionRequest,
): Promise<AccountDeletionResult & { emailDelivery: string }> {
  return browserApiClient.readJsonResponse(
    await browserApiClient.request("/api/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

export async function clearDeletedBrowserState(): Promise<void> {
  requestLocalVaultLock();
  clearAccountDirectoryPreferences();
  await clearAllOfflineVaultData();
  const response = await browserApiClient.post("/auth/logout");
  if (!response.ok) throw new Error("Browser session cleanup failed.");
}

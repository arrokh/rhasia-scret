"use client";

import { clearAccountDirectoryPreferences } from "@/modules/authenticator-account";
import { terminateBrowserSession } from "@/modules/identity";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import type { AccountDeletionPreview, AccountDeletionResult } from "../application/account-deletion-repository";
import type { AccountDeletionRequest } from "../domain/account-deletion-policy";

export async function loadAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  return browserApiClient.getJson<AccountDeletionPreview>("/api/v1/me/deletion/preview", { cache: "no-store" });
}

export async function requestAccountDeletionOtp(): Promise<void> {
  await browserApiClient.postEmpty("/api/v1/me/deletion/otp/request");
}

export async function verifyAccountDeletionOtp(otp: string): Promise<void> {
  await browserApiClient.postEmpty("/api/v1/me/deletion/otp/verify", { otp });
}

export async function deleteAccount(
  request: AccountDeletionRequest,
): Promise<AccountDeletionResult & { emailDelivery: string }> {
  return browserApiClient.readJsonResponse(
    await browserApiClient.request("/api/v1/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

export async function clearDeletedBrowserState(): Promise<void> {
  let sessionTerminationFailed = false;
  let sessionTerminationError: unknown;
  try {
    await terminateBrowserSession();
  } catch (error) {
    sessionTerminationFailed = true;
    sessionTerminationError = error;
  }

  let directoryCleanupFailed = false;
  let directoryCleanupError: unknown;
  try {
    clearAccountDirectoryPreferences();
  } catch (error) {
    directoryCleanupFailed = true;
    directoryCleanupError = error;
  }

  if (sessionTerminationFailed) throw sessionTerminationError;
  if (directoryCleanupFailed) throw directoryCleanupError;
}

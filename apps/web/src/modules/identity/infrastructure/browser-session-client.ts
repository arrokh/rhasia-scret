"use client";

import { clearAllOfflineVaultData, requestVaultSessionChange } from "@/modules/sync";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { captureAnalyticsEvent, resetAnalytics } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

type OperationOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

const LOCAL_CLEANUP_TIMEOUT_MS = 10_000;
const LOGOUT_REQUEST_TIMEOUT_MS = 15_000;

export async function refreshBrowserSessionAssertion(): Promise<void> {
  try {
    await browserApiClient.postJson<{ refreshed: true }>("/api/v1/auth/session/refresh", { client: "web" });
  } catch {
    // Anonymous pages and expired sessions intentionally remain quiet.
  }
}

export async function terminateBrowserSession(): Promise<string> {
  try {
    requestVaultSessionChange();
  } catch {
    // The final announcement retries after cleanup and is authoritative.
  }

  let localCleanupPromise: Promise<void>;
  try {
    localCleanupPromise = clearAllOfflineVaultData();
  } catch (error) {
    localCleanupPromise = Promise.reject(error);
  }
  const localCleanup = settleBeforeTimeout(localCleanupPromise, LOCAL_CLEANUP_TIMEOUT_MS);
  const logout = revokeServerSession();
  const [cleanupOutcome, logoutOutcome] = await Promise.all([localCleanup, logout]);
  // Clear queries again after the revocation attempt so a concurrent refetch cannot repopulate account-scoped state.
  const finalSessionChange = captureOperation(() => requestVaultSessionChange());

  if (!logoutOutcome.ok) throw logoutOutcome.error;
  if (!cleanupOutcome.ok) throw cleanupOutcome.error;
  if (!finalSessionChange.ok) throw finalSessionChange.error;

  captureAnalyticsEvent(ANALYTICS_EVENTS.authenticationSignedOut);
  resetAnalytics();
  return logoutOutcome.value;
}

async function revokeServerSession(): Promise<OperationOutcome<string>> {
  try {
    const response = await browserApiClient.postSessionRevocation({
      signal: AbortSignal.timeout(LOGOUT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || !response.url) throw new Error("Session termination failed.");

    const responseUrl = new URL(response.url);
    if (
      responseUrl.origin !== window.location.origin ||
      responseUrl.pathname !== "/sign-in" ||
      responseUrl.search !== "?auth=signed_out" ||
      responseUrl.hash !== ""
    ) {
      throw new Error("Session termination failed.");
    }
    return { ok: true, value: "/sign-in?auth=signed_out" };
  } catch (error) {
    return { ok: false, error };
  }
}

function captureOperation(operation: () => void): OperationOutcome<void> {
  try {
    operation();
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error };
  }
}

function settleBeforeTimeout(promise: Promise<void>, timeoutMs: number): Promise<OperationOutcome<void>> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      resolve({ ok: false, error: new Error("Local Vault cleanup did not complete before the timeout.") });
    }, timeoutMs);
    promise.then(
      () => {
        window.clearTimeout(timeout);
        resolve({ ok: true, value: undefined });
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        resolve({ ok: false, error });
      },
    );
  });
}

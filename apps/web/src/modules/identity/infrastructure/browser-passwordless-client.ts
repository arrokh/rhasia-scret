"use client";

import { browserApiClient, BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import {
  isSafePasswordlessChallengeExpirySeconds,
  type PasswordlessClient,
  type PasswordlessReturnPath,
} from "../application/passwordless-client-contract";
import { isPwaDisplayMode, type PendingPwaAuthenticationHandoff } from "./pwa-authentication";
import type { PasswordlessSignInClient } from "../presentation/request-email-sign-in-link";

export const browserPasswordlessClient: PasswordlessSignInClient = {
  async requestMagicLink({ email, returnPath, client, handoffId, handoffVerifier, turnstileToken }) {
    const resolvedClient: PasswordlessClient = client ?? (isPwaDisplayMode() ? "pwa" : "web");
    try {
      const response = await browserApiClient.postJson<{
        sent: true;
        challengeExpiresInSeconds: unknown;
      }>("/api/v1/auth/magic-link/request", {
        email,
        client: resolvedClient,
        returnPath,
        ...(resolvedClient === "pwa" ? { handoffId, handoffVerifier } : {}),
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      if (response.sent !== true || !isSafePasswordlessChallengeExpirySeconds(response.challengeExpiresInSeconds))
        return { error: new Error("Passwordless challenge response is invalid.") };
      return { error: null, challengeExpiresInSeconds: response.challengeExpiresInSeconds };
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 429) return { error: { status: 429 } };
      return { error };
    }
  },
};

export async function redeemBrowserMagicLink(token: string): Promise<Readonly<{ returnPath: PasswordlessReturnPath }>> {
  return browserApiClient.postJson<Readonly<{ returnPath: PasswordlessReturnPath }>>("/api/v1/auth/magic-link/redeem", {
    token,
    client: "web",
  });
}

export async function redeemPwaMagicLink(
  token: string,
): Promise<Readonly<{ refreshToken: string; returnPath: PasswordlessReturnPath }>> {
  return browserApiClient.postJson<Readonly<{ refreshToken: string; returnPath: PasswordlessReturnPath }>>(
    "/api/v1/auth/magic-link/redeem",
    { token, client: "pwa" },
  );
}

export async function publishPwaAuthenticationHandoff(handoffId: string, refreshToken: string): Promise<void> {
  await browserApiClient.postJson<{ published: true }>("/api/v1/auth/pwa/session", { handoffId, refreshToken });
}

export async function pollPwaAuthenticationHandoff(
  handoff: PendingPwaAuthenticationHandoff,
): Promise<Readonly<{ pending: true } | { accepted: true; returnPath: PasswordlessReturnPath }>> {
  return browserApiClient.postJson<
    Readonly<{ pending: true } | { accepted: true; returnPath: PasswordlessReturnPath }>
  >("/api/v1/auth/pwa/session", { handoffId: handoff.handoffId, verifier: handoff.verifier });
}

"use client";

import { browserApiClient, BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import type { PasswordlessReturnPath } from "../application/passwordless-authentication";
import type { PasswordlessSignInClient } from "../presentation/request-email-sign-in-link";

export const browserPasswordlessClient: PasswordlessSignInClient = {
  async requestMagicLink({ email, returnPath }) {
    try {
      await browserApiClient.postJson<{ sent: true }>("/api/auth/magic-link/request", {
        email,
        client: "web",
        returnPath,
      });
      return { error: null };
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 429) return { error: { status: 429 } };
      return { error };
    }
  },
};

export async function redeemBrowserMagicLink(token: string): Promise<Readonly<{ returnPath: PasswordlessReturnPath }>> {
  return browserApiClient.postJson<Readonly<{ returnPath: PasswordlessReturnPath }>>("/api/auth/magic-link/redeem", {
    token,
    client: "web",
  });
}

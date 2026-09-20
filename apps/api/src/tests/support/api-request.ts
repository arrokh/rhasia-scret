import { ApiRequest } from "@api/http/api-request";
import { attachApiRequestContext, type ApiRequestContext } from "@api/http/api-context";
import { createDisabledEmailSenders } from "@api/smtp-email-senders";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export const testApiBindings = {
  WEB_ORIGIN: "https://web.example.test",
  PROXY_SECRET: "proxy-secret-that-is-long-enough-for-tests-123456",
  AUTH_BACKEND: "passwordless",
  AUTH_SESSION_SECRET: "test-session-secret-12345678901234567890",
  AUTH_MAGIC_LINK_SECRET: "test-magic-link-secret-12345678901234567890",
  EMAIL_SENDERS: createDisabledEmailSenders(),
  PASSKEY_ORIGIN: "https://web.example.test",
  PASSKEY_RP_ID: "web.example.test",
} as const;

export function apiTestRequest(
  path: string,
  init: RequestInit | undefined = undefined,
  context: Partial<ApiRequestContext> = {},
): ApiRequest {
  const request = new ApiRequest(`https://api.example.test${path}`, init);
  attachApiRequestContext(request, {
    database: {} as PrismaDatabase,
    bindings: testApiBindings,
    emailSenders: testApiBindings.EMAIL_SENDERS,
    sessionVerifier: { verify: async () => null },
    sessionTerminator: { terminateCurrentSession: async () => undefined },
    passwordlessAuth: {} as ApiRequestContext["passwordlessAuth"],
    applicationUsers: {} as ApiRequestContext["applicationUsers"],
    userCryptoProfiles: {} as ApiRequestContext["userCryptoProfiles"],
    checkApplicationRateLimit: async () => ({ status: "allowed" }),
    ...context,
  });
  return request;
}

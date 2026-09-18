import type { MiddlewareHandler } from "hono";
import { attachApiRequestContext, type ApiRequestContext } from "@api/http/api-context";
import { ApiRequest } from "@api/http/api-request";
import { createApplicationRateLimitCheckerForDatabase } from "@api/modules/rate-limiting/server";
import {
  authBackend,
  createApplicationUserRepository,
  createPasswordlessAuthService,
  createSessionTerminator,
  createSessionVerifier,
  createUserCryptoProfileRepository,
} from "@api/modules/identity/server";
import type { PasswordlessAuthService } from "@api/modules/identity/application/passwordless-authentication";
import type { ApiEmailSenders, ApiEnvironment, ApiBindings } from "@api/types";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { createSmtpEmailSenders } from "@api/smtp-email-senders";

export function createApiRuntime(emailSenders?: ApiEmailSenders): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const bindings = context.env as ApiBindings;
    const database = bindings.DATABASE_CLIENT;
    if (!database) return context.json({ error: "api_misconfigured" }, 503);
    const runtimeEmailSenders =
      emailSenders ?? (authBackend(bindings) === "passwordless" ? createSmtpEmailSenders(bindings) : undefined);
    const passwordlessAuth = createPasswordlessService(database, bindings, runtimeEmailSenders?.magicLink);
    const request = new ApiRequest(context.req.raw);
    request.headers.set("x-request-id", context.get("requestId"));
    if (bindings.WEB_ORIGIN) request.headers.set("x-rhasia-expected-origin", bindings.WEB_ORIGIN);
    const runtime: ApiRequestContext = {
      database,
      bindings,
      emailSenders: runtimeEmailSenders,
      sessionVerifier: createSessionVerifier(database, bindings, runtimeEmailSenders?.magicLink),
      sessionTerminator: createSessionTerminator(database, bindings, runtimeEmailSenders?.magicLink),
      passwordlessAuth,
      applicationUsers: createApplicationUserRepository(database, bindings),
      userCryptoProfiles: createUserCryptoProfileRepository(database),
      checkApplicationRateLimit: createApplicationRateLimitCheckerForDatabase(database),
    };
    attachApiRequestContext(request, runtime);
    context.set("apiRequest", request);
    await next();
  };
}

export const apiRuntime = createApiRuntime();

function createPasswordlessService(
  database: PrismaDatabase,
  bindings: ApiBindings,
  emailSender?: ApiEmailSenders["magicLink"],
): PasswordlessAuthService {
  if (authBackend(bindings) === "passwordless") return createPasswordlessAuthService(database, bindings, emailSender);
  return {
    requestLink: async () => {
      throw new Error("Passwordless authentication is not configured.");
    },
    redeem: async () => null,
    verifyAccessToken: async () => null,
    verifyBrowserSession: async () => null,
    refresh: async () => null,
    revoke: async () => undefined,
    publishPwaHandoff: async () => undefined,
    redeemPwaHandoff: async () => null,
  };
}

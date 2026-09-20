import { attachApiRequestContext, type ApiRequestContext } from "@api/http/api-context";
import { apiFactory } from "@api/http/hono-factory";
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
import type { ApiEmailSenders, ApiBindings } from "@api/types";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export function createApiRuntime() {
  return apiFactory.createMiddleware(async (context, next) => {
    const bindings = context.env as ApiBindings;
    const database = bindings.DATABASE_CLIENT;
    if (!database) return context.json({ error: "api_misconfigured" }, 503);
    const emailSenders = bindings.EMAIL_SENDERS;
    if (!emailSenders) return context.json({ error: "api_misconfigured" }, 503);
    const passwordlessAuth = createPasswordlessService(database, bindings, emailSenders.magicLink);
    const request = new ApiRequest(context.req.raw);
    request.headers.set("x-request-id", context.get("requestId"));
    if (bindings.WEB_ORIGIN) request.headers.set("x-rhasia-expected-origin", bindings.WEB_ORIGIN);
    const runtime: ApiRequestContext = {
      database,
      bindings,
      emailSenders,
      sessionVerifier: createSessionVerifier(database, bindings, emailSenders.magicLink),
      sessionTerminator: createSessionTerminator(database, bindings, emailSenders.magicLink),
      passwordlessAuth,
      applicationUsers: createApplicationUserRepository(database, bindings),
      userCryptoProfiles: createUserCryptoProfileRepository(database),
      checkApplicationRateLimit: createApplicationRateLimitCheckerForDatabase(database),
    };
    attachApiRequestContext(request, runtime);
    context.set("apiRequest", request);
    await next();
  });
}

export const apiRuntime = createApiRuntime();

function createPasswordlessService(
  database: PrismaDatabase,
  bindings: ApiBindings,
  emailSender: ApiEmailSenders["magicLink"],
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

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
import { createPrismaClient } from "@api/shared/infrastructure/prisma-client";
import type { ApiEnvironment, ApiBindings } from "@api/types";

export const apiRuntime: MiddlewareHandler<ApiEnvironment> = async (context, next) => {
  const bindings = context.env as ApiBindings;
  const connectionString = bindings.HYPERDRIVE?.connectionString;
  const database = bindings.DATABASE_CLIENT ?? (connectionString ? createPrismaClient(connectionString) : undefined);
  if (!database) return context.json({ error: "api_misconfigured" }, 503);
  const ownsDatabase = bindings.DATABASE_CLIENT === undefined;
  try {
    const passwordlessAuth = createPasswordlessService(database, bindings);
    const request = new ApiRequest(context.req.raw);
    if (bindings.WEB_ORIGIN) request.headers.set("x-rhasia-expected-origin", bindings.WEB_ORIGIN);
    const runtime: ApiRequestContext = {
      database,
      bindings,
      sessionVerifier: createSessionVerifier(database, bindings),
      sessionTerminator: createSessionTerminator(database, bindings),
      passwordlessAuth,
      applicationUsers: createApplicationUserRepository(database, bindings),
      userCryptoProfiles: createUserCryptoProfileRepository(database),
      checkApplicationRateLimit: createApplicationRateLimitCheckerForDatabase(database),
    };
    attachApiRequestContext(request, runtime);
    context.set("apiRequest", request);
    await next();
  } finally {
    if (ownsDatabase) await database.$disconnect();
  }
};

function createPasswordlessService(
  database: ReturnType<typeof createPrismaClient>,
  bindings: ApiBindings,
): PasswordlessAuthService {
  if (authBackend(bindings) === "passwordless") return createPasswordlessAuthService(database, bindings);
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

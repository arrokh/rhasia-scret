import { attachApiRequestContext, type ApiRequestContext } from "@api/http/api-context";
import { apiFactory } from "@api/http/hono-factory";
import { ApiRequest } from "@api/http/api-request";
import { createIdentityRuntime } from "@api/modules/identity/server";
import type { ApiBindings, ApiEmailSenders } from "@api/types";
import { createApiApplicationRuntime, type ApiApplicationRuntime } from "@api/modules/server-composition/runtime";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { IdentityRuntime } from "@api/modules/identity";

export type ApiRuntimeDependencies = Readonly<{
  identity: IdentityRuntime;
  applicationRuntime: ApiApplicationRuntime;
}>;

export function createApiRuntime(fixedDependencies?: ApiRuntimeDependencies) {
  return apiFactory.createMiddleware(async (context, next) => {
    const bindings = context.env as ApiBindings;
    const database = bindings.DATABASE_CLIENT;
    if (!database) return context.json({ error: "api_misconfigured" }, 503);
    const emailSenders = bindings.EMAIL_SENDERS;
    if (!emailSenders) return context.json({ error: "api_misconfigured" }, 503);
    const identity = fixedDependencies?.identity ?? createIdentityRuntime(database, bindings, emailSenders.magicLink);
    const request = new ApiRequest(context.req.raw);
    request.headers.set("x-request-id", context.get("requestId"));
    if (bindings.WEB_ORIGIN) request.headers.set("x-rhasia-expected-origin", bindings.WEB_ORIGIN);
    const runtime: ApiRequestContext = {
      applicationRuntime: fixedDependencies?.applicationRuntime ?? createApiApplicationRuntime(database, bindings),
      bindings,
      emailSenders,
      identity,
    };
    attachApiRequestContext(request, runtime);
    context.set("apiRequest", request);
    await next();
  });
}

export function createApiRuntimeDependencies(
  database: PrismaDatabase,
  bindings: ApiBindings,
  emailSenders: ApiEmailSenders,
): ApiRuntimeDependencies {
  return {
    identity: createIdentityRuntime(database, bindings, emailSenders.magicLink),
    applicationRuntime: createApiApplicationRuntime(database, bindings),
  };
}

import { Hono } from "hono";
import type { ApiEnvironment } from "@api/types";
import { jsonResponse } from "@api/http/response";
import { requestContext, exactOriginCors, proxyTrust } from "@api/middleware/security";
import { apiRequestLogging } from "@api/middleware/request-logging";
import { logApiEvent } from "@api/shared/infrastructure/logging";
import { systemRoutes } from "@api/routes/system";
import { registerV1Routes } from "@api/routes/v1";
import { apiRuntime } from "@api/http/api-runtime";

export function createApiApp(): Hono<ApiEnvironment> {
  const versioned = new Hono<ApiEnvironment>();
  versioned.use("*", async (context, next) => {
    if (context.req.path === "/v1/health" || context.req.path === "/v1/time") return next();
    return apiRuntime(context, next);
  });
  versioned.route("", systemRoutes);
  registerV1Routes(versioned);

  const app = new Hono<ApiEnvironment>();
  app.use("*", requestContext);
  app.use("*", apiRequestLogging);
  app.use("*", proxyTrust);
  app.use("*", exactOriginCors);
  app.route("/v1", versioned);
  app.notFound(() => jsonResponse({ error: "not_found" }, { status: 404 }));
  app.onError((_error, context) => {
    logApiEvent("error", "api_internal_error", { requestId: context.get("requestId") });
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  });
  return app;
}

export const app = createApiApp();
export type AppType = typeof app;

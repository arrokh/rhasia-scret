import { Hono } from "hono";
import type { ApiEnvironment } from "@api/types";
import { jsonResponse } from "@api/http/response";
import { requestContext, exactOriginCors, proxyTrust } from "@api/middleware/security";
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
  app.use("*", proxyTrust);
  app.use("*", exactOriginCors);
  app.route("/v1", versioned);
  app.notFound(() => jsonResponse({ error: "not_found" }, { status: 404 }));
  app.onError((_error, context) => {
    console.error(JSON.stringify({ requestId: context.get("requestId"), error: "internal_error" }));
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  });
  return app;
}

export const app = createApiApp();
export type AppType = typeof app;

import { apiFactory } from "@api/http/hono-factory";
import { logApiEvent } from "@api/shared/infrastructure/logging";

const SYSTEM_PATHS = new Set(["/v1/health", "/v1/time"]);

export const apiRequestLogging = apiFactory.createMiddleware(async (context, next) => {
  if (SYSTEM_PATHS.has(context.req.path)) return next();

  const startedAt = Date.now();
  let failed = false;
  try {
    await next();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const status = failed ? 500 : context.res.status;
    logApiEvent(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "api_request", {
      requestId: context.get("requestId"),
      method: context.req.method,
      path: context.req.path,
      status,
      durationMs: Date.now() - startedAt,
    });
  }
});

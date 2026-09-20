import { apiFactory } from "@api/http/hono-factory";
import { jsonResponse } from "@api/http/response";
import { healthResponseSchema, timeResponseSchema } from "@rhasia-scret/api-contract";

export const systemRoutes = apiFactory
  .createApp()
  .get("/health", () => jsonResponse(healthResponseSchema.parse({ status: "ok" })))
  .get("/time", () =>
    jsonResponse(timeResponseSchema.parse({ now: new Date().toISOString() }), {
      headers: { "cache-control": "no-store" },
    }),
  );

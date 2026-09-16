import { Hono } from "hono";
import type { ApiEnvironment } from "@api/types";
import { jsonResponse } from "@api/http/response";
import { healthResponseSchema, timeResponseSchema } from "@rhasia-scret/api-contract";

export const systemRoutes = new Hono<ApiEnvironment>()
  .get("/health", () => jsonResponse(healthResponseSchema.parse({ status: "ok" })))
  .get("/time", () =>
    jsonResponse(timeResponseSchema.parse({ now: new Date().toISOString() }), {
      headers: { "cache-control": "no-store" },
    }),
  );

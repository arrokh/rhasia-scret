import { apiFactory } from "@api/http/hono-factory";
import { jsonResponse } from "@api/http/response";
import { createSystemResponseBody } from "@api/routes/system-contract";

export const systemRoutes = apiFactory
  .createApp()
  .get("/health", () => jsonResponse(createSystemResponseBody("health")))
  .get("/time", () => jsonResponse(createSystemResponseBody("time"), { headers: { "cache-control": "no-store" } }));

import {
  healthResponseSchema,
  timeResponseSchema,
  type HealthResponse,
  type TimeResponse,
} from "@rhasia-scret/api-contract";

export type SystemRoute = "health" | "time";
export type SystemResponseBody = HealthResponse | TimeResponse;

export function createSystemResponseBody(route: SystemRoute): SystemResponseBody {
  if (route === "health") return healthResponseSchema.parse({ status: "ok" });
  return timeResponseSchema.parse({ now: new Date().toISOString() });
}

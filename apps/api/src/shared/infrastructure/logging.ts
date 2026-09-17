import type { ApiRequest } from "@api/http/api-request";

type ApiLogLevel = "info" | "warn" | "error";
type ApiLogFields = Readonly<Record<string, boolean | number | string | null | undefined>>;

export function logApiEvent(level: ApiLogLevel, event: string, fields: ApiLogFields = {}): void {
  const line = JSON.stringify({ event, ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function logApiDependencyFailure(request: ApiRequest, event: string, error: unknown): void {
  logApiEvent("error", event, {
    requestId: request.headers.get("x-request-id") ?? "unknown",
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

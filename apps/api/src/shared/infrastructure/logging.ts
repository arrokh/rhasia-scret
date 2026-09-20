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
    requestId: opaqueRequestId(request.headers.get("x-request-id")),
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

function opaqueRequestId(value: string | null): string {
  return value &&
    /^(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(value)
    ? value
    : "untrusted";
}

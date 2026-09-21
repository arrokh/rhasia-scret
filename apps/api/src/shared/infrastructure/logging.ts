import type { ApiRequest } from "@api/http/api-request";

type ApiLogLevel = "info" | "warn" | "error";
type ApiLogFields = Readonly<Record<string, boolean | number | string | null | undefined>>;
type ApiDependencyLogFields = Readonly<{
  dependency?:
    | "turnstile"
    | "anonymous_auth_rate_limiter"
    | "passwordless_challenge_database"
    | "smtp_email_delivery"
    | "passwordless_authentication";
  client?: "web" | "pwa" | "mobile";
  durationMs?: number;
  reason?: "transport" | "http_error" | "malformed_response" | "factory_error";
  providerStatus?: number | null;
}>;

type ErrorWithCode = Error & { cause?: unknown; code?: unknown };
const SAFE_ERROR_CODES = new Set([
  "EAUTH",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "EENVELOPE",
  "EMESSAGE",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPROTOCOL",
  "ESOCKET",
  "ETIMEDOUT",
  "ETLS",
]);

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

export function logApiDependencyFailure(
  request: ApiRequest,
  event: string,
  error: unknown,
  fields: ApiDependencyLogFields = {},
): void {
  const errorCode = safeErrorCode(error);
  logApiEvent("error", event, {
    ...fields,
    ...(errorCode ? { errorCode } : {}),
    requestId: opaqueRequestId(request.headers.get("x-request-id")),
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

function safeErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!(current instanceof Error)) return undefined;
    const code = (current as ErrorWithCode).code;
    if (typeof code === "string" && (SAFE_ERROR_CODES.has(code) || /^P\d{4}$/.test(code))) return code;
    current = (current as ErrorWithCode).cause;
  }
  return undefined;
}

function opaqueRequestId(value: string | null): string {
  return value &&
    /^(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(value)
    ? value
    : "untrusted";
}

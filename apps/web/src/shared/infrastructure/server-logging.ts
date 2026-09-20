type ServerLogLevel = "info" | "warn" | "error";
type ServerLogFields = Readonly<Record<string, boolean | number | string | null | undefined>>;

export function logWebServerEvent(level: ServerLogLevel, event: string, fields: ServerLogFields = {}): void {
  const line = JSON.stringify({ event, ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

const OPAQUE_REQUEST_ID =
  /^(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && OPAQUE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}

export function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

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

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === (request.headers.get("x-rhasia-expected-origin") ?? requestPublicOrigin(request));
  } catch {
    return false;
  }
}

export function isSameOriginIfPresent(request: Request): boolean {
  return !request.headers.has("origin") || isSameOrigin(request);
}

export function isClientOriginAllowed(request: Request, client: "web" | "mobile" | "pwa"): boolean {
  if (client === "mobile") return isSameOriginIfPresent(request);
  return isSameOrigin(request);
}

export function requestPublicOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function requestClientIp(request: Request): string | null {
  if (!request.headers.has("x-rhasia-proxy-secret")) return null;
  const forwarded = request.headers.get("x-rhasia-client-ip")?.trim();
  return forwarded && forwarded.length <= 128 ? forwarded : null;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === (request.headers.get("x-rhasia-expected-origin") ?? requestPublicOrigin(request));
  } catch {
    return false;
  }
}

export function requestPublicOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function requestClientIp(request: Request): string | null {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp && cloudflareIp.length <= 128) return cloudflareIp;
  if (!request.headers.has("x-rhasia-proxy-secret")) return null;
  const forwarded = request.headers.get("x-rhasia-client-ip")?.trim();
  return forwarded && forwarded.length <= 128 ? forwarded : null;
}

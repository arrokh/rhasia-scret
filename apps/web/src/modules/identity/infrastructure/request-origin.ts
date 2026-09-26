import type { NextRequest } from "next/server";

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === requestPublicOrigin(request);
  } catch {
    return false;
  }
}

/**
 * Resolve the canonical origin used by CSRF checks and redirects. A configured
 * origin takes precedence over forwarding headers so a directly exposed app
 * cannot be redirected or authorized by client-supplied proxy metadata.
 */
export function requestPublicOrigin(request: NextRequest): string {
  const configuredCandidates = [[process.env.AUTH_APP_ORIGIN, true]] as const;
  for (const [candidate, originOnly] of configuredCandidates) {
    if (!candidate?.trim()) continue;
    try {
      const configured = new URL(candidate);
      if (
        (configured.protocol === "https:" ||
          configured.hostname === "localhost" ||
          configured.hostname === "127.0.0.1") &&
        (!originOnly || configured.pathname === "/") &&
        !configured.search &&
        !configured.hash &&
        !configured.username &&
        !configured.password
      )
        return configured.origin;
    } catch {
      // Invalid authentication configuration fails closed at its own boundary.
    }
  }

  const forwardedHost =
    process.env.AUTH_TRUST_PROXY_HEADERS === "true"
      ? request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim()
      : undefined;
  const forwardedProtocol =
    process.env.AUTH_TRUST_PROXY_HEADERS === "true"
      ? request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim()
      : undefined;
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return request.nextUrl.origin;
  }
}

export function requestClientIp(request: NextRequest): string | null {
  if (process.env.AUTH_TRUST_PROXY_HEADERS !== "true") return null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || null;
  return candidate && candidate.length <= 128 ? candidate : null;
}

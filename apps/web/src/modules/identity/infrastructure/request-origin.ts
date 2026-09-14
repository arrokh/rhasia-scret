import type { NextRequest } from "next/server";

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const submittedOrigin = new URL(origin);
    const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
    const expectedProtocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    return submittedOrigin.host === expectedHost && submittedOrigin.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

export function requestClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || null;
  return candidate && candidate.length <= 128 ? candidate : null;
}

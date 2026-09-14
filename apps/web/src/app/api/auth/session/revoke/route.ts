import { NextResponse, type NextRequest } from "next/server";
import { createPasswordlessAuthService, isSameOrigin } from "@/modules/identity/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("origin") && !isSameOrigin(request)) return new NextResponse(null, { status: 403 });
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
  try {
    const service = createPasswordlessAuthService();
    const principal = await service.verifyAccessToken(token);
    if (principal?.sessionId) await service.revoke(principal.sessionId);
  } catch {
    // Logout is intentionally idempotent and never discloses session state.
  }
  return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
}

function readBearerToken(authorization: string | null): string | null {
  const match = authorization ? /^Bearer ([A-Za-z0-9_.-]{1,512})$/.exec(authorization) : null;
  return match?.[1] ?? null;
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

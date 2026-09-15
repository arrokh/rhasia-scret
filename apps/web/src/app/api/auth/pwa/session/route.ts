import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_RETURN_PATH_COOKIE,
  createPasswordlessAuthService,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  isSameOrigin,
  readPasswordlessConfiguration,
  setPasswordlessSessionCookies,
} from "@/modules/identity/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readJson(request);
  if (!body || typeof body.handoffId !== "string")
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (!isSameOrigin(request)) return new NextResponse(null, { status: 403, headers: noStoreHeaders() });

  try {
    const service = createPasswordlessAuthService();
    if (typeof body.refreshToken === "string") {
      if (!isSafePwaHandoffId(body.handoffId))
        return NextResponse.json({ error: "handoff_failed" }, { status: 401, headers: noStoreHeaders() });
      await service.publishPwaHandoff(body.refreshToken, body.handoffId);
      return NextResponse.json({ published: true }, { headers: noStoreHeaders() });
    }
    if (typeof body.verifier !== "string" || !isSafePwaHandoffVerifier(body.verifier))
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });

    const result = await service.redeemPwaHandoff(body.handoffId, body.verifier);
    if (!result) return NextResponse.json({ pending: true }, { status: 202, headers: noStoreHeaders() });
    const response = NextResponse.json(
      { accepted: true, returnPath: result.returnPath },
      { headers: noStoreHeaders() },
    );
    await setPasswordlessSessionCookies(response.cookies, result.session, readPasswordlessConfiguration());
    response.cookies.set(AUTH_RETURN_PATH_COOKIE, "", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "handoff_failed" }, { status: 401, headers: noStoreHeaders() });
  }
}

async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  clearPasswordlessSessionCookies,
  createPasswordlessAuthService,
  createSessionVerifier,
  isSameOrigin,
  PASSWORDLESS_REFRESH_COOKIE,
} from "@/modules/identity/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readJson(request);
  const client = body?.client;
  if (client !== "mobile" && client !== "web")
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (
    (client === "web" && !isSameOrigin(request)) ||
    (client === "mobile" && request.headers.get("origin") && !isSameOrigin(request))
  )
    return new NextResponse(null, { status: 403, headers: noStoreHeaders() });
  if (client === "web") return verifyBrowserSession();

  const refreshToken =
    typeof body?.refreshToken === "string"
      ? body.refreshToken
      : (await cookies()).get(PASSWORDLESS_REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });

  try {
    const session = await createPasswordlessAuthService().refresh(refreshToken);
    if (!session) return NextResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });
    return NextResponse.json(
      {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        accessExpiresAt: session.accessExpiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString(),
        email: session.principal.email,
      },
      { headers: noStoreHeaders() },
    );
  } catch {
    return NextResponse.json({ error: "session_unavailable" }, { status: 401, headers: noStoreHeaders() });
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

async function verifyBrowserSession(): Promise<NextResponse> {
  const session = await createSessionVerifier().verify("active-session");
  if (session) return NextResponse.json({ refreshed: true }, { headers: noStoreHeaders() });
  const response = NextResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });
  clearPasswordlessSessionCookies(response.cookies);
  return response;
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

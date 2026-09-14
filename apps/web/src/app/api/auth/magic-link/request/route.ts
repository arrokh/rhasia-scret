import { NextResponse, type NextRequest } from "next/server";
import {
  createAnonymousAuthRateLimiter,
  createPasswordlessAuthService,
  isPasswordlessClient,
  isPasswordlessReturnPath,
  isSameOrigin,
  requestClientIp,
} from "@/modules/identity/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readJson(request);
  if (
    !body ||
    !isPasswordlessClient(body.client) ||
    !isPasswordlessReturnPath(body.returnPath) ||
    typeof body.email !== "string"
  )
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (body.client === "web" && !isSameOrigin(request)) return new NextResponse(null, { status: 403 });
  if (body.client === "mobile" && request.headers.get("origin") && !isSameOrigin(request))
    return new NextResponse(null, { status: 403 });

  try {
    const limiter = createAnonymousAuthRateLimiter();
    const limit = await limiter.check(body.email.trim().toLowerCase(), requestClientIp(request), new Date());
    if (!limit.allowed)
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { ...noStoreHeaders(), "Retry-After": String(limit.retryAfterSeconds) } },
      );
    await createPasswordlessAuthService().requestLink({
      email: body.email,
      client: body.client,
      returnPath: body.returnPath,
    });
    return NextResponse.json({ sent: true }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "email_delivery_failed" }, { status: 503, headers: noStoreHeaders() });
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

import { NextResponse } from "next/server";
import type { AuthenticatedApplicationResult } from "@/modules/server-composition";

type DeniedResult = Exclude<AuthenticatedApplicationResult, { status: "allowed" }>;

export function authenticatedApplicationFailureResponse(result: DeniedResult): NextResponse {
  if (result.status === "unauthenticated") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (result.status === "inactive_user") {
    return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  }
  if (result.status === "application_user_unavailable") {
    return NextResponse.json({ error: "application_user_unavailable" }, { status: 403 });
  }
  return NextResponse.json(
    { error: result.status },
    {
      status: result.status === "rate_limited" ? 429 : 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(result.retryAfterSeconds),
      },
    },
  );
}

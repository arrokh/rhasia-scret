import { NextResponse } from "next/server";
import type { ApplicationRateLimitOutcome } from "../application/check-application-rate-limit";

export function applicationRateLimitResponse(outcome: Exclude<ApplicationRateLimitOutcome, { status: "allowed" }>): NextResponse {
  return NextResponse.json(
    { error: outcome.status === "limited" ? "rate_limited" : "rate_limit_unavailable" },
    {
      status: outcome.status === "limited" ? 429 : 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(outcome.retryAfterSeconds)
      }
    }
  );
}

import type { NextRequest } from "next/server";
import { isSameOrigin } from "@/modules/identity/server";

export function isBrowserAccountDeletionRequest(request: NextRequest): boolean {
  return isSameOrigin(request) && !request.headers.has("authorization");
}

export function isBrowserAccountDeletionReadRequest(request: NextRequest): boolean {
  if (request.headers.has("authorization")) return false;
  const origin = request.headers.get("origin");
  return origin ? isSameOrigin(request) : request.headers.get("sec-fetch-site") === "same-origin";
}

export function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store" };
}

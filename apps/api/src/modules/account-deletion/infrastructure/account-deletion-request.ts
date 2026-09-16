import { isSameOrigin } from "@api/modules/identity";

export function isBrowserAccountDeletionRequest(request: Request): boolean {
  return !request.headers.has("authorization") && isSameOrigin(request);
}

export function isBrowserAccountDeletionReadRequest(request: Request): boolean {
  return !request.headers.has("authorization") && isSameOrigin(request);
}

export function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store" };
}

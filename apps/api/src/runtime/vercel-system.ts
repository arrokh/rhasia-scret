import { jsonResponse, noStoreHeaders } from "@api/http/response";
import { isProxySecretValid, requestId } from "@api/middleware/security";
import {
  API_CORS_ALLOW_HEADERS_VALUE,
  API_CORS_ALLOW_METHODS_VALUE,
  API_CORS_EXPOSE_HEADERS_VALUE,
  API_CORS_MAX_AGE_SECONDS,
  isAllowedApiOrigin,
} from "@api/middleware/cors-policy";
import { createSystemResponseBody, type SystemRoute } from "@api/routes/system-contract";
import type { ApiBindings } from "@api/types";

export type VercelSystemRoute = SystemRoute;
type SystemBindings = Pick<ApiBindings, "PROXY_SECRET" | "WEB_ORIGIN">;

export function createVercelSystemResponse(
  request: Request,
  route: VercelSystemRoute,
  bindings: SystemBindings,
): Response {
  const headers = noStoreHeaders();
  headers.set("x-request-id", requestId(request.headers.get("x-request-id") ?? undefined));

  const suppliedProxySecret = request.headers.get("x-rhasia-proxy-secret");
  if (suppliedProxySecret !== null && !isProxySecretValid(suppliedProxySecret, bindings.PROXY_SECRET))
    return jsonResponse({ error: "forbidden" }, { status: 403, headers });

  applyCorsHeaders(headers, request, bindings.WEB_ORIGIN);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (request.method !== "GET" && request.method !== "HEAD")
    return jsonResponse({ error: "not_found" }, { status: 404, headers });

  const body = createSystemResponseBody(route);
  headers.set("content-type", "application/json; charset=UTF-8");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function applyCorsHeaders(headers: Headers, request: Request, configuredOrigin: string | undefined): void {
  const origin = request.headers.get("origin");
  if (isAllowedApiOrigin(origin ?? undefined, configuredOrigin) && origin)
    headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", API_CORS_EXPOSE_HEADERS_VALUE);

  if (request.method === "OPTIONS") {
    headers.append("vary", "Origin");
    headers.set("access-control-max-age", String(API_CORS_MAX_AGE_SECONDS));
    headers.set("access-control-allow-methods", API_CORS_ALLOW_METHODS_VALUE);
    headers.set("access-control-allow-headers", API_CORS_ALLOW_HEADERS_VALUE);
    headers.append("vary", "Access-Control-Request-Headers");
    return;
  }

  headers.append("vary", "Origin");
}

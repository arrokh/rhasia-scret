import { cors } from "hono/cors";
import { apiFactory } from "@api/http/hono-factory";
import {
  API_CORS_ALLOW_HEADERS,
  API_CORS_ALLOW_METHODS,
  API_CORS_EXPOSE_HEADERS,
  API_CORS_MAX_AGE_SECONDS,
  isAllowedApiOrigin,
} from "@api/middleware/cors-policy";

const OPAQUE_REQUEST_ID =
  /^(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const requestContext = apiFactory.createMiddleware(async (context, next) => {
  context.set("requestId", requestId(context.req.header("x-request-id")));
  context.set("proxyRequest", false);
  await next();
  context.header("x-request-id", context.get("requestId"));
});

export const noStoreApiResponses = apiFactory.createMiddleware(async (context, next) => {
  try {
    await next();
  } finally {
    if (!context.res.headers.has("cache-control")) context.header("cache-control", "no-store");
  }
});

export const exactOriginCors = apiFactory.createMiddleware(
  cors({
    origin: (origin, context) => {
      const configured = context.env.WEB_ORIGIN;
      return isAllowedApiOrigin(origin, configured) ? origin : undefined;
    },
    allowMethods: [...API_CORS_ALLOW_METHODS],
    allowHeaders: [...API_CORS_ALLOW_HEADERS],
    exposeHeaders: [...API_CORS_EXPOSE_HEADERS],
    credentials: false,
    maxAge: API_CORS_MAX_AGE_SECONDS,
  }),
);

export const proxyTrust = apiFactory.createMiddleware(async (context, next) => {
  const supplied = context.req.header("x-rhasia-proxy-secret");
  const configured = context.env.PROXY_SECRET;
  if (supplied !== undefined) {
    if (!isProxySecretValid(supplied, configured)) return context.json({ error: "forbidden" }, 403);
    context.set("proxyRequest", true);
  }
  await next();
});

export function requestId(value: string | undefined): string {
  return value && OPAQUE_REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

export function isProxySecretValid(supplied: string, configured: string | undefined): boolean {
  return Boolean(configured && timingSafeStringEqual(supplied, configured));
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

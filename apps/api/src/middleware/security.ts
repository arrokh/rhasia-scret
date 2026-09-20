import { cors } from "hono/cors";
import { apiFactory } from "@api/http/hono-factory";

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
      if (!origin || !configured) return undefined;
      return origin === configured ? origin : undefined;
    },
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "if-none-match", "if-match", "x-request-id"],
    exposeHeaders: ["etag", "last-modified", "x-request-id", "retry-after"],
    credentials: false,
    maxAge: 600,
  }),
);

export const proxyTrust = apiFactory.createMiddleware(async (context, next) => {
  const supplied = context.req.header("x-rhasia-proxy-secret");
  const configured = context.env.PROXY_SECRET;
  if (supplied !== undefined) {
    if (!configured || !timingSafeStringEqual(supplied, configured)) return context.json({ error: "forbidden" }, 403);
    context.set("proxyRequest", true);
  }
  await next();
});

export function requestId(value: string | undefined): string {
  return value && OPAQUE_REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

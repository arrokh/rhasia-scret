import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ApiEnvironment } from "@api/types";

const REQUEST_ID_MAX_LENGTH = 128;

export const requestContext: MiddlewareHandler<ApiEnvironment> = async (context, next) => {
  context.set("requestId", requestId(context.req.header("x-request-id")));
  context.set("proxyRequest", false);
  await next();
  context.header("x-request-id", context.get("requestId"));
};

export const exactOriginCors: MiddlewareHandler<ApiEnvironment> = cors({
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
});

export const proxyTrust: MiddlewareHandler<ApiEnvironment> = async (context, next) => {
  const supplied = context.req.header("x-rhasia-proxy-secret");
  const configured = context.env.PROXY_SECRET;
  if (supplied !== undefined) {
    if (!configured || !timingSafeStringEqual(supplied, configured)) return context.json({ error: "forbidden" }, 403);
    context.set("proxyRequest", true);
  }
  await next();
};

export function requestId(value: string | undefined): string {
  if (!value || value.length > REQUEST_ID_MAX_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(value)) return crypto.randomUUID();
  return value;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

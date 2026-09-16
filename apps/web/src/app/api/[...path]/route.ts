import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-encoding",
  "cache-control",
  "content-type",
  "if-match",
  "if-none-match",
  "range",
  "user-agent",
  "authorization",
  "cookie",
  "origin",
  "referer",
  "x-request-id",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "location",
  "retry-after",
  "vary",
  "www-authenticate",
  "x-request-id",
  "x-sync-cursor",
  "x-sync-revision",
] as const;

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_TIMEOUT_MS = 15_000;

type ProxyConfig = Readonly<{
  apiOrigin: URL;
  webOrigin: string;
  proxySecret: string;
}>;

type RouteContext = { params: Promise<{ path: string[] }> };

type FetchInitWithDuplex = RequestInit & { duplex?: "half" };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context);
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  if (path[0] !== "v1" || path.length < 2) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let configuration: ProxyConfig;
  try {
    configuration = readProxyConfig();
  } catch {
    return NextResponse.json({ error: "proxy_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  if (!isTrustedBrowserRequest(request, configuration.webOrigin))
    return NextResponse.json(
      { error: "same_origin_required" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(`/${path.map(encodePathSegment).join("/")}`, configuration.apiOrigin);
  } catch {
    return NextResponse.json({ error: "invalid_path" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  upstreamUrl.search = new URL(request.url).search;
  const headers = forwardedRequestHeaders(request, configuration);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS"
          ? undefined
          : request.body,
      signal: controller.signal,
      ...(request.body && request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS"
        ? { duplex: "half" }
        : {}),
    } as FetchInitWithDuplex);
    return createProxyResponse(upstream, configuration.apiOrigin.origin, configuration.webOrigin);
  } catch (error) {
    const status = error instanceof DOMException && error.name === "AbortError" ? 504 : 502;
    return NextResponse.json(
      { error: status === 504 ? "upstream_timeout" : "upstream_unavailable" },
      { status, headers: { "cache-control": "no-store" } },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readProxyConfig(): ProxyConfig {
  const apiOrigin = parseOrigin(process.env.API_ORIGIN, "API_ORIGIN");
  const webOrigin = parseOrigin(process.env.WEB_ORIGIN ?? process.env.AUTH_APP_ORIGIN, "WEB_ORIGIN").origin;
  const proxySecret = process.env.API_PROXY_SECRET;
  if (!proxySecret || proxySecret.length < 32) throw new Error("API_PROXY_SECRET is not configured.");
  return { apiOrigin: apiOrigin.url, webOrigin, proxySecret };
}

function parseOrigin(value: string | undefined, name: string): { origin: string; url: URL } {
  if (!value) throw new Error(`${name} is not configured.`);
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (!localHttp && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(`${name} must be an origin.`);
  return { origin: url.origin, url };
}

function isTrustedBrowserRequest(request: NextRequest, webOrigin: string): boolean {
  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin !== webOrigin && !areLocalLoopbackOrigins(requestOrigin, webOrigin)) return false;
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== webOrigin && !areLocalLoopbackOrigins(suppliedOrigin, webOrigin))
    return false;
  if (MUTATION_METHODS.has(request.method) && request.headers.has("cookie") && !suppliedOrigin) return false;
  return true;
}

function areLocalLoopbackOrigins(left: string, right: string): boolean {
  try {
    const first = new URL(left);
    const second = new URL(right);
    return (
      first.protocol === "http:" &&
      second.protocol === "http:" &&
      first.port === second.port &&
      [first.hostname, second.hostname].every((hostname) => hostname === "localhost" || hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function forwardedRequestHeaders(request: NextRequest, configuration: ProxyConfig): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.delete("x-rhasia-proxy-secret");
  headers.set("x-rhasia-proxy-secret", configuration.proxySecret);
  headers.set("origin", configuration.webOrigin);
  return headers;
}

function createProxyResponse(upstream: Response, apiOrigin: string, webOrigin: string): NextResponse {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, name === "location" ? rewriteLocation(value, apiOrigin, webOrigin) : value);
  }

  const upstreamHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const cookies =
    upstreamHeaders.getSetCookie?.() ??
    (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie") as string] : []);
  for (const cookie of cookies) headers.append("set-cookie", cookie);

  return new NextResponse(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function rewriteLocation(value: string, apiOrigin: string, webOrigin: string): string {
  try {
    const location = new URL(value);
    if (location.origin === apiOrigin) return `${webOrigin}${location.pathname}${location.search}${location.hash}`;
  } catch {
    // Relative redirects are already safe to pass through.
  }
  return value;
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment));
}

export function normalizeVercelRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.slice("/api".length) || "/";
  }
  return new Request(url, request);
}

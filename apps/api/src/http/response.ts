export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=UTF-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function noStoreHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
  });
}

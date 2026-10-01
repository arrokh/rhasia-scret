export function GET(_request: Request): Response {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}

export {};

const originValue = process.env.SMOKE_API_ORIGIN?.trim();
if (!originValue) throw new Error("SMOKE_API_ORIGIN is required.");

const apiOrigin = parseOrigin(originValue);
const timeout = AbortSignal.timeout(10_000);

const health = await requestJson("/v1/health");
if (health.response.status !== 200 || health.body?.status !== "ok")
  throw new Error(`health check returned HTTP ${health.response.status}.`);
requireNoStore("health", health.response);

const time = await requestJson("/v1/time");
if (time.response.status !== 200 || typeof time.body?.now !== "string")
  throw new Error(`time check returned HTTP ${time.response.status}.`);
requireNoStore("time", time.response);

const retention = await fetch(`${apiOrigin}/v1/internal/retention-purge`, {
  headers: { accept: "application/json" },
  redirect: "error",
  signal: timeout,
});
if (retention.status !== 401) throw new Error(`retention authorization check returned HTTP ${retention.status}.`);
requireNoStore("retention authorization", retention);

console.log(JSON.stringify({ valid: true, origin: apiOrigin, checks: ["health", "time", "retention authorization"] }));

async function requestJson(path: string): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  const response = await fetch(`${apiOrigin}${path}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: timeout,
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // The status check below reports the bounded failure without echoing a body.
  }
  return { response, body };
}

function requireNoStore(name: string, response: Response): void {
  if (response.headers.get("cache-control") !== "no-store")
    throw new Error(`${name} response did not contain Cache-Control: no-store.`);
}

function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SMOKE_API_ORIGIN must be a valid origin.");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localHttp && process.env.SMOKE_ALLOW_HTTP === "1"))
    throw new Error("SMOKE_API_ORIGIN must use HTTPS, or local HTTP with SMOKE_ALLOW_HTTP=1.");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("SMOKE_API_ORIGIN must contain only an origin.");
  return url.origin;
}

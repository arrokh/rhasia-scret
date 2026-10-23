import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (process.env.PWA_UPDATE_TESTS !== "1") return new Response(null, { status: 404 });

  const source = await readFile(join(process.cwd(), "public/sw.js"), "utf8");
  const update = source.replace(
    'const CACHE_VERSION = "rhasia-scret-static-v7";',
    'const CACHE_VERSION = "rhasia-scret-static-v8";',
  );
  if (update === source) return new Response(null, { status: 500 });

  return new Response(update, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { getRequestListener } from "@hono/node-server";
import { normalizeVercelRequest } from "@api/runtime/vercel-path";
import type { StandaloneApi } from "@api/standalone";

let apiPromise: Promise<StandaloneApi> | undefined;

function getApi(): Promise<StandaloneApi> {
  return (apiPromise ??= import("@api/standalone").then(({ createStandaloneApi }) => createStandaloneApi(process.env)));
}

export default getRequestListener(async (request) => {
  const standalone = await getApi();
  return standalone.app.fetch(normalizeVercelRequest(request), standalone.bindings);
});

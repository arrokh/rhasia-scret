import { getRequestListener } from "@hono/node-server";
import { createStandaloneApi, type StandaloneApi } from "@api/standalone";
import { normalizeVercelRequest } from "@api/runtime/vercel-path";

let api: StandaloneApi | undefined;

function getApi(): StandaloneApi {
  return (api ??= createStandaloneApi(process.env));
}

export default getRequestListener(async (request) => {
  const standalone = getApi();
  return standalone.app.fetch(normalizeVercelRequest(request), standalone.bindings);
});

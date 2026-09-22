import { getRequestListener } from "@hono/node-server";
import { normalizeVercelRequest } from "@api/runtime/vercel-path";
import { jsonResponse } from "@api/http/response";
import { isAuthenticationConfigurationError } from "@api/modules/identity/infrastructure/auth-backend";
import { logApiEvent } from "@api/shared/infrastructure/logging";
import { requestId } from "@api/middleware/security";
import type { StandaloneApi } from "@api/standalone";

let apiPromise: Promise<StandaloneApi> | undefined;

function getApi(): Promise<StandaloneApi> {
  return (apiPromise ??= import("@api/standalone").then(({ createStandaloneApi }) => createStandaloneApi(process.env)));
}

export default getRequestListener(async (request) => {
  try {
    const standalone = await getApi();
    return standalone.app.fetch(normalizeVercelRequest(request), standalone.bindings);
  } catch (error) {
    if (!isAuthenticationConfigurationError(error)) throw error;
    const correlationId = requestId(request.headers.get("x-request-id") ?? undefined);
    logApiEvent("error", "api_authentication_misconfigured", { requestId: correlationId, field: error.field });
    return jsonResponse(
      { error: "authentication_misconfigured" },
      { status: 503, headers: { "cache-control": "no-store", "x-request-id": correlationId } },
    );
  }
});

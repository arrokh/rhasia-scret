import { serve } from "@hono/node-server";
import { createStandaloneApi, type StandaloneApi } from "@api/standalone";
import { loadLocalApiEnvironment } from "@api/runtime/environment";
import { isAuthenticationConfigurationError } from "@api/modules/identity/infrastructure/auth-backend";
import { logApiEvent } from "@api/shared/infrastructure/logging";

const environment = loadLocalApiEnvironment();
let api: StandaloneApi;
try {
  api = createStandaloneApi(environment);
} catch (error) {
  if (!isAuthenticationConfigurationError(error)) throw error;
  logApiEvent("error", "api_startup_authentication_misconfigured", {
    field: error.field,
    requestId: "startup",
  });
  process.exit(1);
}
const server = serve({
  fetch: (request) => api.app.fetch(request, api.bindings),
  port: Number(environment.PORT ?? "8787"),
});
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const closeAllConnections = (server as unknown as { closeAllConnections?: () => void }).closeAllConnections;
  closeAllConnections?.call(server);
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await api.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

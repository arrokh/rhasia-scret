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

type BunServer = Readonly<{ stop(force?: boolean): void }>;
declare const Bun: Readonly<{
  serve(options: { port: number; fetch(request: Request): Response | Promise<Response> }): BunServer;
}>;

const server = Bun.serve({
  port: Number(environment.PORT ?? "8787"),
  fetch: (request) => api.app.fetch(request, api.bindings),
});

async function shutdown(): Promise<void> {
  server.stop(true);
  await api.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

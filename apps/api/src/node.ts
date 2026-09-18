import { serve } from "@hono/node-server";
import { createStandaloneApi } from "@api/standalone";
import { loadLocalApiEnvironment } from "@api/runtime/environment";

const environment = loadLocalApiEnvironment();
const api = createStandaloneApi(environment);
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

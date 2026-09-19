import { createStandaloneApi } from "@api/standalone";
import { loadLocalApiEnvironment } from "@api/runtime/environment";

const environment = loadLocalApiEnvironment();
const api = createStandaloneApi(environment);

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

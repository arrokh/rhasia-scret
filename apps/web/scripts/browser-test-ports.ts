import { createServer } from "node:net";

export const BROWSER_TEST_PORT_OFFSET = 1;
export const BROWSER_API_PORT_OFFSET = 5687;
const MIN_BROWSER_TEST_BASE_PORT = 3_200;
const MAX_BROWSER_TEST_BASE_PORT = 65_534 - BROWSER_API_PORT_OFFSET - BROWSER_TEST_PORT_OFFSET;
const PORT_ALLOCATION_ATTEMPTS = 20;

type PortSource = Readonly<{
  BROWSER_TEST_PORT?: string;
  [key: string]: string | undefined;
}>;

export async function resolveBrowserTestPort(source: PortSource = process.env): Promise<number> {
  const configured = source.BROWSER_TEST_PORT?.trim();
  if (configured) return parseBrowserTestPort(configured);

  for (let attempt = 0; attempt < PORT_ALLOCATION_ATTEMPTS; attempt += 1) {
    const candidate = randomPortInRange(MIN_BROWSER_TEST_BASE_PORT, MAX_BROWSER_TEST_BASE_PORT);
    const requiredPorts = [
      candidate,
      candidate + BROWSER_TEST_PORT_OFFSET,
      candidate + BROWSER_API_PORT_OFFSET,
      candidate + BROWSER_API_PORT_OFFSET + BROWSER_TEST_PORT_OFFSET,
    ];
    if (await portsAvailable(requiredPorts)) return candidate;
  }

  throw new Error("Unable to allocate isolated browser-test ports.");
}

export function parseBrowserTestPort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("BROWSER_TEST_PORT must be a numeric TCP port.");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65534)
    throw new Error("BROWSER_TEST_PORT must be between 1024 and 65534.");
  return port;
}

function randomPortInRange(minimum: number, maximum: number): number {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

async function portsAvailable(ports: readonly number[]): Promise<boolean> {
  for (const port of ports) {
    if (!(await portAvailable(port))) return false;
  }
  return true;
}

async function portAvailable(port: number): Promise<boolean> {
  for (const host of ["::", "0.0.0.0"] as const) {
    const server = createServer();
    const result = await new Promise<"available" | "occupied" | "unsupported">((resolve) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        resolve(error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL" ? "unsupported" : "occupied");
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve("available");
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port });
    });
    await closeServer(server);
    if (result === "occupied") return false;
  }
  return true;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

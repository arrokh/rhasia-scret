import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const staticDirectory = join(process.cwd(), ".next", "static");
const forbidden = [
  /\bSUPABASE_SERVICE_ROLE_KEY\b/i,
  /\bSUPABASE_SECRET_KEY\b/i,
  /\bDATABASE_URL\b/i,
  /\bDIRECT_URL\b/i,
  /postgres(?:ql)?:\/\//i,
  /service_role/i,
  /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/i,
  /authorization\s*:\s*bearer/i,
];

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

async function main(): Promise<void> {
  const staticFiles = await files(staticDirectory);
  const sourceMaps = staticFiles.filter((path) => path.endsWith(".map"));
  if (sourceMaps.length > 0)
    throw new Error(`Production client source maps are not allowed: ${sourceMaps.length} found.`);
  const textFiles = await Promise.all(
    staticFiles
      .filter((path) => !path.endsWith(".woff2") && !path.endsWith(".png"))
      .map(async (path) => ({ path, text: await readFile(path, "utf8") })),
  );
  const leaked = textFiles.flatMap(({ path, text }) =>
    forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern}`),
  );
  if (leaked.length > 0) throw new Error(`Forbidden client-bundle material detected:\n${leaked.join("\n")}`);
  const totalBytes = (await Promise.all(staticFiles.map(async (path) => (await stat(path)).size))).reduce(
    (total, size) => total + size,
    0,
  );
  console.info(
    `Verified ${staticFiles.length} client assets (${totalBytes} bytes): no source maps or forbidden server secrets.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

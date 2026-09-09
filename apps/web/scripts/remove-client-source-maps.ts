import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

async function findSourceMaps(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await findSourceMaps(path)));
    else if (entry.name.endsWith(".map")) result.push(path);
  }
  return result;
}

async function main(): Promise<void> {
  const files = await findSourceMaps(join(process.cwd(), ".next", "static"));
  await Promise.all(files.map((path) => unlink(path)));
  if (files.length > 0) console.info(`Removed ${files.length} production client source map artifact(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

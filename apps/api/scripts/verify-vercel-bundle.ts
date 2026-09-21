import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const javascriptFiles = await findJavaScriptFiles(distDirectory);
const requiredBundles = ["vercel.js", "vercel-health.js", "vercel-time.js"];
const missingBundles = requiredBundles.filter((name) => !javascriptFiles.some((path) => basename(path) === name));
if (missingBundles.length > 0) throw new Error(`Missing Vercel bundles: ${missingBundles.join(", ")}`);

const bundleContents = new Map(
  await Promise.all(javascriptFiles.map(async (path) => [path, await readFile(path, "utf8")] as const)),
);
if ([...bundleContents.values()].some((content) => content.includes("@api/")))
  throw new Error("The Vercel bundle contains unresolved @api/* imports.");

const vercelBundle = readBundle("vercel.js");
if (!vercelBundle.includes("import(") || vercelBundle.includes("route-handlers"))
  throw new Error(
    "The general Vercel entry must lazy-load the standalone API without eagerly embedding route handlers.",
  );
if (readBundle("vercel-health.js").includes("standalone") || readBundle("vercel-time.js").includes("standalone"))
  throw new Error("The Vercel system bundles must not embed the standalone API composition.");

const chunks = javascriptFiles.filter((path) => !requiredBundles.includes(basename(path)));
if (chunks.length === 0) throw new Error("The Vercel build did not produce route-level shared chunks.");

console.log(
  JSON.stringify({
    valid: true,
    bundles: requiredBundles.map((name) => `dist/${name}`),
    chunkCount: chunks.length,
  }),
);

function readBundle(name: string): string {
  const path = javascriptFiles.find((candidate) => basename(candidate) === name);
  if (!path) throw new Error(`Missing Vercel bundle: ${name}`);
  return bundleContents.get(path) ?? "";
}

async function findJavaScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJavaScriptFiles(path)));
      continue;
    }
    if (entry.isFile() && path.endsWith(".js")) files.push(path);
  }
  return files;
}

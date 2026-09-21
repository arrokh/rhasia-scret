import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bundlePath = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/vercel.js");
const bundle = await readFile(bundlePath, "utf8");

if (bundle.includes("@api/")) {
  throw new Error("The Vercel bundle contains unresolved @api/* imports.");
}

console.log(JSON.stringify({ valid: true, bundle: "dist/vercel.js" }));

import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const routeManifests = {
  "/vaults": "server/app/vaults/page_client-reference-manifest.js",
  "/vaults/manage": "server/app/vaults/manage/page_client-reference-manifest.js",
  "/vaults/manage/[vaultId]": "server/app/vaults/manage/[vaultId]/page_client-reference-manifest.js",
  "/vaults/accounts/new": "server/app/vaults/accounts/new/page_client-reference-manifest.js"
} as const;

const budgets = {
  rawBytes: 750_000,
  gzipBytes: 225_000
} as const;

type ClientReferenceManifest = {
  clientModules: Record<string, { chunks?: string[] }>;
};

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function parseManifest(path: string): ClientReferenceManifest {
  const source = readFileSync(path, "utf8").trim();
  const assignment = source.indexOf(" = {");
  if (assignment < 0 || !source.endsWith(";")) throw new Error(`Unsupported client reference manifest: ${path}`);
  return JSON.parse(source.slice(assignment + 3, -1)) as ClientReferenceManifest;
}

function chunkPath(buildDirectory: string, publicPath: string): string {
  const relative = publicPath.replace(/^\/_next\//, "");
  return join(buildDirectory, relative);
}

const buildDirectory = resolve(argument("--build-dir", ".next"));
const output = resolve(argument("--output", "test-results/performance/route-bundles.json"));
const label = argument("--label", "implementation");
const enforce = process.argv.includes("--enforce");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;

const routes = Object.fromEntries(Object.entries(routeManifests).map(([route, manifestPath]) => {
  const manifest = parseManifest(join(buildDirectory, manifestPath));
  const chunks = [...new Set(Object.values(manifest.clientModules).flatMap((module) => module.chunks ?? []))].sort();
  const files = chunks.map((publicPath) => {
    const path = chunkPath(buildDirectory, publicPath);
    const bytes = statSync(path).size;
    const gzipBytes = gzipSync(readFileSync(path)).byteLength;
    return { path: publicPath, bytes, gzipBytes };
  });
  const rawBytes = files.reduce((total, file) => total + file.bytes, 0);
  const gzipBytes = files.reduce((total, file) => total + file.gzipBytes, 0);
  return [route, {
    rawBytes,
    gzipBytes,
    chunks: files.length,
    withinBudget: rawBytes <= budgets.rawBytes && gzipBytes <= budgets.gzipBytes,
    files
  }];
}));

const report = { schemaVersion: 1, label, commit, dirty, budgets, routes };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, label, commit, routes: Object.fromEntries(Object.entries(routes).map(([route, value]) => [route, { rawBytes: value.rawBytes, gzipBytes: value.gzipBytes, chunks: value.chunks, withinBudget: value.withinBudget }])) }, null, 2));

if (enforce && Object.values(routes).some((route) => !route.withinBudget)) process.exitCode = 1;

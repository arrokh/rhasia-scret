import { builtinModules, createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const allowedExternalDependencies = ["@prisma/adapter-pg", "@prisma/client", "dotenv", "nodemailer", "pg"];
const externalImports = findExternalImports(bundleContents.values());
const unresolvedExternalImports = externalImports.filter(
  (specifier) => !allowedExternalDependencies.includes(specifier),
);
if (unresolvedExternalImports.length > 0)
  throw new Error(
    `The Vercel bundle contains unresolved runtime package imports: ${unresolvedExternalImports.join(", ")}`,
  );
const require = createRequire(import.meta.url);
const missingExternalDependencies = allowedExternalDependencies.filter((specifier) => {
  try {
    require.resolve(specifier);
    return false;
  } catch {
    return true;
  }
});
if (missingExternalDependencies.length > 0)
  throw new Error(
    `The Vercel build cannot resolve external runtime dependencies: ${missingExternalDependencies.join(", ")}`,
  );

const vercelBundle = readBundle("vercel.js");
if (!vercelBundle.includes("import(") || vercelBundle.includes("route-handlers"))
  throw new Error(
    "The general Vercel entry must lazy-load the standalone API without eagerly embedding route handlers.",
  );
if (readBundle("vercel-health.js").includes("standalone") || readBundle("vercel-time.js").includes("standalone"))
  throw new Error("The Vercel system bundles must not embed the standalone API composition.");

const chunks = javascriptFiles.filter((path) => !requiredBundles.includes(basename(path)));
if (chunks.length === 0) throw new Error("The Vercel build did not produce route-level shared chunks.");

const standalonePath = javascriptFiles.find((path) => basename(path).startsWith("standalone-") && path.endsWith(".js"));
if (!standalonePath) throw new Error("The Vercel build did not produce the standalone API bundle.");
await verifyStandaloneRuntime(standalonePath);

console.log(
  JSON.stringify({
    valid: true,
    bundles: requiredBundles.map((name) => `dist/${name}`),
    chunkCount: chunks.length,
  }),
);

type StandaloneModule = {
  createStandaloneApi(source: Record<string, string>): {
    app: { request(input: string, init: RequestInit, bindings: unknown): Promise<Response> };
    bindings: unknown;
    close(): Promise<void>;
  };
};

async function verifyStandaloneRuntime(path: string): Promise<void> {
  const standaloneModule = (await import(pathToFileURL(path).href)) as StandaloneModule;
  const standalone = standaloneModule.createStandaloneApi({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic",
    WEB_ORIGIN: "https://synthetic.example.test",
    PROXY_SECRET: "synthetic-proxy-secret-abcdefghijklmnopqrstuvwxyz",
    AUTH_BACKEND: "passwordless",
    AUTH_APP_ORIGIN: "https://synthetic.example.test",
    AUTH_MAGIC_LINK_SECRET: "synthetic-magic-link-secret-abcdefghijklmnopqrstuvwxyz",
    AUTH_SESSION_SECRET: "synthetic-session-secret-abcdefghijklmnopqrstuvwxyz",
    TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
    CRON_SECRET: "synthetic-cron-secret",
    SMTP_HOST: "smtp.synthetic.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
    SMTP_USER: "synthetic-user",
    SMTP_PASSWORD: "synthetic-password",
    AUTH_EMAIL_FROM: "noreply@synthetic.example.test",
  });
  try {
    const response = await standalone.app.request(
      "https://synthetic.example.test/v1/auth/session/refresh",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      standalone.bindings,
    );
    if (response.status !== 400) {
      throw new Error(`The standalone Vercel bundle smoke request returned HTTP ${response.status}; expected 400.`);
    }
  } finally {
    await standalone.close();
  }
}

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

function findExternalImports(contents: Iterable<string>): string[] {
  const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
  const imports = new Set<string>();
  const pattern = /^\s*(?:import\s+(?:[^;\n]*?\s+from\s+)?|(?:}\s+)?from\s+)["']([^"']+)["']/gm;
  for (const content of contents) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".") || builtins.has(specifier)) continue;
      imports.add(specifier);
    }
  }
  return [...imports].sort();
}

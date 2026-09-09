import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const packageFiles = [
  "package.json",
  "apps/web/package.json",
  "apps/mobile/package.json",
  "packages/client-vault-core/package.json",
];

const packageVersions = await Promise.all(
  packageFiles.map(async (relativePath) => {
    const contents = await readFile(resolve(repositoryRoot, relativePath), "utf8");
    const packageJson = JSON.parse(contents);
    return [relativePath, packageJson.version];
  }),
);

const appConfig = await readFile(resolve(repositoryRoot, "apps/mobile/app.config.ts"), "utf8");
const appConfigVersion = appConfig.match(/^\s*version:\s*"([^"]+)"\s*,?\s*$/m)?.[1];
const versions = [...packageVersions, ["apps/mobile/app.config.ts", appConfigVersion]];
const [sourcePath, sourceVersion] = versions[0];

if (typeof sourceVersion !== "string" || !versionPattern.test(sourceVersion)) {
  throw new Error(`${sourcePath} must define a valid SemVer release version.`);
}

const mismatches = versions.filter(
  ([, version]) => version !== sourceVersion || typeof version !== "string" || !versionPattern.test(version),
);
if (mismatches.length > 0) {
  const details = mismatches.map(([path, version]) => `${path}=${String(version)}`).join(", ");
  throw new Error(`Release version ${sourceVersion} is not aligned: ${details}`);
}

console.info(
  `Release version ${sourceVersion} is aligned across the root, web, mobile, core, and Expo app configuration.`,
);

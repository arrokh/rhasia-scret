import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const prohibited = /(?:^|\b)(?:AGPL|GPL|SSPL|UNLICENSED|UNKNOWN)(?:\b|$)/i;

type LicenseCatalog = Record<string, Array<{ name: string; license?: string }>>;

async function main(): Promise<void> {
  const { stdout } = await execFileAsync("pnpm", ["licenses", "list", "--json"], { maxBuffer: 10 * 1024 * 1024 });
  const catalog = JSON.parse(stdout) as LicenseCatalog;
  const findings = Object.entries(catalog).flatMap(([license, packages]) => prohibited.test(license) ? packages.map(({ name }) => `${name}: ${license}`) : []);
  if (findings.length > 0) throw new Error(`Prohibited dependency licenses detected:\n${findings.join("\n")}`);
  const packageCount = Object.values(catalog).reduce((count, packages) => count + packages.length, 0);
  console.info(`Reviewed licenses for ${packageCount} dependency entries; no prohibited license identifiers found.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

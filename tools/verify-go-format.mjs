import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(repositoryRoot, "apps/api");

const result = spawnSync("gofmt", ["-l", "."], {
  cwd: apiRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (result.error) {
  console.error(`Could not run gofmt: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else if (result.stdout.trim()) {
  console.error(`Go files are not formatted:\n${result.stdout.trim()}`);
  process.exitCode = 1;
} else {
  console.log("Go formatting verified.");
}

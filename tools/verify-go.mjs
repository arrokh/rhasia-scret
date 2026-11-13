import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(repositoryRoot, "apps/api");
// Go integration packages share the job-owned disposable database. Serialize package execution so
// table-wide retention purges cannot consume another package's synthetic fixtures.
const commands = [
  ["Verify Go module checksums", ["go", ["mod", "verify"]]],
  ["Scan Go packages for known vulnerabilities", ["go", ["run", "golang.org/x/vuln/cmd/govulncheck@v1.8.0", "./..."]]],
  [
    "Review Go dependency licenses",
    [
      "go",
      [
        "run",
        "github.com/google/go-licenses/v2@v2.0.1",
        "check",
        "./...",
        "--ignore=github.com/nooroctavian/rhasia-scret/apps/api",
        "--disallowed_types=forbidden,unknown",
      ],
    ],
  ],
  ["Vet Go packages", ["go", ["vet", "./..."]]],
  // The race-enabled run covers every test. Do not rerun table-wide retention purges against the
  // same job-owned database; prior test fixtures can remain eligible for later purge sweeps.
  ["Run Go unit, integration, and race tests", ["go", ["test", "-p=1", "-race", "./...", "-count=1"]]],
  ["Build native Go packages", ["go", ["build", "./..."]]],
  ["Cross-build Linux amd64 Go packages", ["go", ["build", "./..."]], { GOOS: "linux", GOARCH: "amd64" }],
];

for (const [label, [command, arguments_], overrides = {}] of commands) {
  console.log(`==> ${label}`);
  const result = spawnSync(command, arguments_, {
    cwd: apiRoot,
    env: { ...process.env, ...overrides },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Failed to start ${label}: ${result.error.message}`);
    process.exitCode = 1;
    process.exit();
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    process.exit();
  }
}

import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const target = process.env.CI === "true" ? "test:hosted" : "test:container";
const child = spawn(command, ["run", target], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`Failed to start ${target}: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

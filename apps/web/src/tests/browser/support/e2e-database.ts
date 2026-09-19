import { spawn } from "node:child_process";

export async function cleanBrowserE2eUsers(emails?: readonly string[]): Promise<void> {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(
    command,
    ["--dir", "../api", "exec", "tsx", "scripts/clean-browser-e2e-users.ts", ...(emails ?? [])],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`API browser E2E cleanup failed (${code ?? signal ?? "unknown"}).`));
    });
  });
}

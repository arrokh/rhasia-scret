import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** Load the repository's shared environment contract for app-local scripts. */
export function loadWorkspaceEnvironment(): void {
  loadDotenv({ path: resolve(scriptDirectory, "../../../.env") });
  loadDotenv({ path: resolve(scriptDirectory, "../.env") });
  loadDotenv({ path: resolve(scriptDirectory, "../.env.local") });
}

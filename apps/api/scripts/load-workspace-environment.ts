import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

/** Load the repository-root environment contract for workspace scripts. */
export function loadWorkspaceEnvironment(): void {
  // Web package commands execute with apps/web as their working directory.
  loadDotenv({ path: resolve(process.cwd(), "../../.env") });
}

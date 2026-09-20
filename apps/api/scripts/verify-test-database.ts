import { loadWorkspaceEnvironment } from "./load-workspace-environment";
import { describeDatabaseTarget } from "./database-test-policy";
import { verifyDatabaseConnection } from "./database-test-preflight";

loadWorkspaceEnvironment();

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for database integration checks.");

  try {
    await verifyDatabaseConnection(connectionString);
  } catch (error) {
    throw new Error(`Cannot reach ${describeDatabaseTarget(connectionString)}.`, { cause: error });
  }

  console.log("Test database connection verified.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

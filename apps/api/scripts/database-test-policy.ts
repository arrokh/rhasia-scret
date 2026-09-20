export const DATABASE_TEST_TIMEOUT_MS = 1_000;

export function requiresDatabaseIntegration(environment: NodeJS.ProcessEnv): boolean {
  return environment.CI === "true" || environment.REQUIRE_DATABASE_INTEGRATION === "1";
}

export function describeDatabaseTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.protocol}//${url.hostname}:${url.port || "5432"}/${url.pathname.slice(1)}`;
  } catch {
    return "the configured database";
  }
}

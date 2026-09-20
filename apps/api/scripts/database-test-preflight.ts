import { Pool } from "pg";
import { DATABASE_TEST_TIMEOUT_MS } from "./database-test-policy";

export async function verifyDatabaseConnection(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: DATABASE_TEST_TIMEOUT_MS,
    max: 1,
  });

  try {
    await pool.query("SELECT 1");
  } finally {
    await pool.end();
  }
}

import { createInterface } from "node:readline/promises";
import process from "node:process";

const operation = process.argv.slice(2).join(" ") || "this database operation";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Database operations require confirmation from an interactive terminal.");
  process.exit(1);
}

const readline = createInterface({ input: process.stdin, output: process.stdout });
try {
  const answer = await readline.question(`About to ${operation}. Type "yes" to continue: `);
  if (answer.trim().toLowerCase() !== "yes") {
    console.error("Database operation cancelled.");
    process.exitCode = 1;
  }
} catch {
  console.error("Database operation cancelled.");
  process.exitCode = 1;
} finally {
  readline.close();
}

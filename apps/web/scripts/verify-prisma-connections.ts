import { loadWorkspaceEnvironment } from "./load-workspace-environment";

loadWorkspaceEnvironment();

type Connection = {
  host: string;
  port: string;
  sslMode: string | null;
};

function describeConnection(name: "DATABASE_URL" | "DIRECT_URL"): Connection {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  return { host: url.host, port: url.port, sslMode: url.searchParams.get("sslmode") };
}

const runtime = describeConnection("DATABASE_URL");
const migration = describeConnection("DIRECT_URL");
if (runtime.host === migration.host && runtime.port === migration.port) {
  throw new Error("DATABASE_URL and DIRECT_URL must not use the same connection endpoint.");
}

console.log(JSON.stringify({
  runtime: { ...runtime, role: "pooled runtime" },
  migrations: { ...migration, role: "provider-supplied migration connection" },
}));

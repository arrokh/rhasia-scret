import { createApiApp } from "@api/app";
import { authBackend } from "@api/modules/identity/server";
import { createSmtpEmailSenders } from "@api/smtp-email-senders";
import { createPrismaClient, type PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { ApiBindings } from "@api/types";
import {
  readApiBindings,
  readRuntimeDatabaseUrl,
  sanitizeApiRuntimeEnvironment,
  type ApiEnvironmentSource,
} from "@api/runtime/environment";

export type StandaloneApi = Readonly<{
  app: ReturnType<typeof createApiApp>;
  bindings: ApiBindings;
  database: PrismaDatabase;
  close(): Promise<void>;
}>;

export function createStandaloneApi(source: ApiEnvironmentSource): StandaloneApi {
  const runtimeEnvironment = sanitizeApiRuntimeEnvironment(source);
  const bindingsWithoutDatabase = readApiBindings(runtimeEnvironment);
  const emailSenders =
    authBackend(bindingsWithoutDatabase) === "passwordless"
      ? createSmtpEmailSenders(bindingsWithoutDatabase)
      : undefined;
  const database = createPrismaClient(readRuntimeDatabaseUrl(runtimeEnvironment));
  const bindings: ApiBindings = { ...bindingsWithoutDatabase, DATABASE_CLIENT: database };
  const app = createApiApp({ emailSenders });

  return {
    app,
    bindings,
    database,
    close: () => database.$disconnect(),
  };
}

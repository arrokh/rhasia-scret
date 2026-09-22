import { createApiApp } from "@api/app";
import { createApiRuntimeDependencies } from "@api/http/api-runtime";
import { authBackend, validateAuthenticationConfiguration } from "@api/modules/identity/server";
import { createDisabledEmailSenders, createSmtpEmailSenders } from "@api/smtp-email-senders";
import { createPrismaClient, type PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { ApiBindings } from "@api/types";
import {
  readApiConfigBindings,
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
  const configBindings = readApiConfigBindings(runtimeEnvironment);
  validateAuthenticationConfiguration(configBindings);
  const emailSenders =
    authBackend(configBindings) === "none" ? createDisabledEmailSenders() : createSmtpEmailSenders(configBindings);
  const database = createPrismaClient(readRuntimeDatabaseUrl(runtimeEnvironment));
  const bindings: ApiBindings = {
    ...configBindings,
    DATABASE_CLIENT: database,
    EMAIL_SENDERS: emailSenders,
  };
  const runtimeDependencies = createApiRuntimeDependencies(database, bindings, emailSenders);
  const app = createApiApp({ runtimeDependencies });

  return {
    app,
    bindings,
    database,
    close: () => database.$disconnect(),
  };
}

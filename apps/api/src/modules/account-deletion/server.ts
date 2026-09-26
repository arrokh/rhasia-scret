import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type { ApiBindings } from "@api/types";
import type { AccountDeletionEmailSender } from "./application/account-deletion-email";
import {
  completeAccountDeletion,
  type CompleteAccountDeletionDependencies,
  type CompleteAccountDeletionResult,
} from "./application/complete-account-deletion";
import type { AccountDeletionRepository } from "./application/account-deletion-repository";
import type { AccountDeletionAuthBackend, AccountDeletionRequest } from "./domain/account-deletion-policy";
import {
  AccountDeletionAuthorizationError,
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  AccountDeletionPlanStaleError,
} from "./domain/account-deletion-errors";
import {
  ACCOUNT_DELETION_AUTHORIZATION_COOKIE,
  clearDeletionCookies,
  setDeletionAuthorizationCookie,
} from "./infrastructure/account-deletion-authorization";
import {
  isBrowserAccountDeletionReadRequest,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
} from "./infrastructure/account-deletion-request";
import { PrismaAccountDeletionRepository } from "./infrastructure/prisma-account-deletion-repository";

export type {
  AccountDeletionEmailSender,
  AccountDeletionRepository,
  AccountDeletionRequest,
  CompleteAccountDeletionDependencies,
  CompleteAccountDeletionResult,
};
export { completeAccountDeletion };
export {
  ACCOUNT_DELETION_AUTHORIZATION_COOKIE,
  AccountDeletionAuthorizationError,
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  AccountDeletionPlanStaleError,
  clearDeletionCookies,
  isBrowserAccountDeletionReadRequest,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  setDeletionAuthorizationCookie,
};

export function createAccountDeletionRepository(
  database: PrismaDatabase,
  bindings: ApiBindings,
): AccountDeletionRepository {
  const configuration = bindings.AUTH_SESSION_SECRET;
  if (!configuration || configuration.length < 32)
    throw new Error("Account deletion session secret is not configured.");
  const anonymousSecret = bindings.AUTH_MAGIC_LINK_SECRET;
  if (!anonymousSecret || anonymousSecret.length < 32)
    throw new Error("Account deletion anonymous secret is not configured.");
  return new PrismaAccountDeletionRepository(
    new TextEncoder().encode(configuration),
    database,
    new TextEncoder().encode(anonymousSecret),
  );
}

export function accountDeletionBackend(bindings: ApiBindings): AccountDeletionAuthBackend {
  if (bindings.AUTH_BACKEND === "passwordless") return "passwordless";
  throw new Error("Account deletion requires an authentication backend.");
}

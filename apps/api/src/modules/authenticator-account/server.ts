import { PrismaExpiredAccountPurgeRepository } from "./infrastructure/prisma-expired-account-purge-repository";
import { PrismaPersonalAccountRepository } from "./infrastructure/prisma-personal-account-repository";
import { PrismaSharedAccountRepository } from "./infrastructure/prisma-shared-account-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export {
  purgeExpiredAuthenticatorAccounts,
  type AccountPurgeBatch,
  type ExpiredAccountPurgeRepository,
} from "./application/purge-expired-accounts";
export type { PersonalAccountRepository } from "./application/personal-account-repository";
export type { SharedAccountMutationResult, SharedAccountRepository } from "./application/shared-account-repository";

export function createExpiredAccountPurgeRepository(database: PrismaDatabase): PrismaExpiredAccountPurgeRepository {
  return new PrismaExpiredAccountPurgeRepository(database);
}

export function createPersonalAccountRepository(database: PrismaDatabase): PrismaPersonalAccountRepository {
  return new PrismaPersonalAccountRepository(database);
}

export function createSharedAccountRepository(database: PrismaDatabase): PrismaSharedAccountRepository {
  return new PrismaSharedAccountRepository(database);
}

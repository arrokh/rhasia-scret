import { PrismaExpiredAccountPurgeRepository } from "./infrastructure/prisma-expired-account-purge-repository";
import { PrismaPersonalAccountRepository } from "./infrastructure/prisma-personal-account-repository";
import { PrismaSharedAccountRepository } from "./infrastructure/prisma-shared-account-repository";

export {
  purgeExpiredAuthenticatorAccounts,
  type AccountPurgeBatch,
  type ExpiredAccountPurgeRepository
} from "./application/purge-expired-accounts";
export type { PersonalAccountRepository } from "./application/personal-account-repository";
export type { SharedAccountMutationResult, SharedAccountRepository } from "./application/shared-account-repository";

export function createExpiredAccountPurgeRepository(): PrismaExpiredAccountPurgeRepository {
  return new PrismaExpiredAccountPurgeRepository();
}

export function createPersonalAccountRepository(): PrismaPersonalAccountRepository {
  return new PrismaPersonalAccountRepository();
}

export function createSharedAccountRepository(): PrismaSharedAccountRepository {
  return new PrismaSharedAccountRepository();
}

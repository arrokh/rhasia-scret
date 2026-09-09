import type { Prisma } from "@prisma/client";
import { appendVaultAuditEvent } from "@/modules/audit/server";
import { prisma } from "@/shared/infrastructure/prisma-client";
import { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";
import { ACCOUNT_RECOVERY_DAYS, accountPurgeAfter } from "../domain/account-retention-policy";
import type { NewEncryptedAccount, PersonalAccountRepository } from "../application/personal-account-repository";

type AccountRecord = {
  id: string;
  vaultId: string;
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
  revision: number;
};

export class PrismaPersonalAccountRepository implements PersonalAccountRepository {
  constructor(private readonly now: () => Date = () => new Date()) {}
  public async create(
    ownerId: string,
    vaultId: string,
    account: NewEncryptedAccount,
  ): Promise<EncryptedAuthenticatorAccount> {
    return prisma.$transaction(async (transaction) => {
      await assertActivePersonalVault(ownerId, vaultId, transaction);
      const created = await transaction.authenticatorAccount.create({
        data: {
          vaultId,
          encryptedPayload: copyBytes(account.encryptedPayload),
          encryptionVersion: account.encryptionVersion,
        },
      });
      if (account.source === "LOCAL_VAULT_COPY") {
        await appendVaultAuditEvent(transaction, {
          vaultId,
          ownerId,
          actorUserId: ownerId,
          action: "ACCOUNT_COPIED_FROM_LOCAL",
          targetId: created.id,
        });
      }
      return toAccount(created);
    });
  }

  public async list(ownerId: string, vaultId: string): Promise<EncryptedAuthenticatorAccount[]> {
    await assertActivePersonalVault(ownerId, vaultId);
    const accounts = await prisma.authenticatorAccount.findMany({
      where: { vaultId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return accounts.map(toAccount);
  }

  public async update(
    ownerId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    account: NewEncryptedAccount,
  ): Promise<EncryptedAuthenticatorAccount | null> {
    await assertActivePersonalVault(ownerId, vaultId);
    const updated = await prisma.authenticatorAccount.updateMany({
      where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
      data: {
        encryptedPayload: copyBytes(account.encryptedPayload),
        encryptionVersion: account.encryptionVersion,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    return toAccount(await prisma.authenticatorAccount.findUniqueOrThrow({ where: { id: accountId } }));
  }

  public async delete(ownerId: string, vaultId: string, accountId: string, expectedRevision: number): Promise<boolean> {
    await assertActivePersonalVault(ownerId, vaultId);
    const deletedAt = this.now();
    const deleted = await prisma.authenticatorAccount.updateMany({
      where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
      data: { deletedAt, purgeAfter: accountPurgeAfter(deletedAt), revision: { increment: 1 } },
    });
    return deleted.count === 1;
  }

  public async restore(ownerId: string, vaultId: string, accountId: string): Promise<boolean> {
    await assertActivePersonalVault(ownerId, vaultId);
    const now = this.now();
    const restored = await prisma.authenticatorAccount.updateMany({
      where: {
        id: accountId,
        vaultId,
        deletedAt: { not: null },
        OR: [
          { purgeAfter: { gt: now } },
          {
            purgeAfter: null,
            deletedAt: { gt: new Date(now.getTime() - ACCOUNT_RECOVERY_DAYS * 24 * 60 * 60 * 1_000) },
          },
        ],
      },
      data: { deletedAt: null, purgeAfter: null, revision: { increment: 1 } },
    });
    return restored.count === 1;
  }
}

async function assertActivePersonalVault(
  ownerId: string,
  vaultId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const vault = await client.vault.findFirst({
    where: { id: vaultId, ownerId, type: "PERSONAL", lifecycle: "ACTIVE", deletedAt: null },
  });
  if (!vault) throw new Error("Personal Vault is unavailable.");
}

function toAccount(record: AccountRecord): EncryptedAuthenticatorAccount {
  return new EncryptedAuthenticatorAccount(
    record.id,
    record.vaultId,
    record.encryptedPayload,
    record.encryptionVersion,
    record.revision,
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

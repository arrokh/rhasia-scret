import type { Prisma } from "@prisma/client";
import { appendVaultAuditEvent } from "@api/modules/audit/server";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { sha256Digest, toBase64Url } from "@api/shared/infrastructure/crypto";
import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
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
  constructor(
    private readonly database: PrismaDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async create(
    ownerId: string,
    vaultId: string,
    account: NewEncryptedAccount,
  ): Promise<EncryptedAuthenticatorAccount> {
    return this.database.$transaction(async (transaction) => {
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
    await assertActivePersonalVault(ownerId, vaultId, this.database);
    const accounts = await this.database.authenticatorAccount.findMany({
      where: { vaultId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return accounts.map(toAccount);
  }

  public async migratePayload(
    ownerId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult> {
    const replacement = copyBytes(migration.replacementCiphertext);
    try {
      if (!validAccountMigration(migration, replacement)) return "conflict";
      return await this.database.$transaction(async (transaction) => {
        const vault = await transaction.$queryRaw<Array<{ id: string; encryptionVersion: number }>>`
          SELECT "id", "encryption_version" AS "encryptionVersion"
          FROM "vaults"
          WHERE "id" = ${vaultId}
            AND "owner_id" = ${ownerId}
            AND "type" = 'PERSONAL'
            AND "lifecycle" = 'ACTIVE'
            AND "deleted_at" IS NULL
          FOR UPDATE
        `;
        if (!vault[0] || vault[0].encryptionVersion !== expectedKeyVersion) return "conflict";
        const account = await transaction.authenticatorAccount.findUnique({
          where: { id: accountId },
          select: { vaultId: true, encryptedPayload: true, revision: true, deletedAt: true },
        });
        if (!account || account.vaultId !== vaultId || account.deletedAt) return "conflict";
        const current = copyBytes(account.encryptedPayload);
        try {
          const currentDigest = digestString(current);
          if (currentDigest === migration.replacementCiphertextDigest) return "already-committed";
          if (
            account.revision !== expectedRevision ||
            current[0] !== migration.expectedEnvelopeVersion ||
            currentDigest !== migration.expectedCiphertextDigest
          )
            return "conflict";
          const updated = await transaction.authenticatorAccount.updateMany({
            where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null, encryptedPayload: current },
            data: { encryptedPayload: replacement },
          });
          return updated.count === 1 ? "committed" : "conflict";
        } finally {
          current.fill(0);
        }
      });
    } finally {
      replacement.fill(0);
    }
  }

  public async update(
    ownerId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    account: NewEncryptedAccount,
  ): Promise<EncryptedAuthenticatorAccount | null> {
    await assertActivePersonalVault(ownerId, vaultId, this.database);
    const updated = await this.database.authenticatorAccount.updateMany({
      where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
      data: {
        encryptedPayload: copyBytes(account.encryptedPayload),
        encryptionVersion: account.encryptionVersion,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    return toAccount(await this.database.authenticatorAccount.findUniqueOrThrow({ where: { id: accountId } }));
  }

  public async delete(ownerId: string, vaultId: string, accountId: string, expectedRevision: number): Promise<boolean> {
    await assertActivePersonalVault(ownerId, vaultId, this.database);
    const deletedAt = this.now();
    const deleted = await this.database.authenticatorAccount.updateMany({
      where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null },
      data: { deletedAt, purgeAfter: accountPurgeAfter(deletedAt), revision: { increment: 1 } },
    });
    return deleted.count === 1;
  }

  public async restore(ownerId: string, vaultId: string, accountId: string): Promise<boolean> {
    await assertActivePersonalVault(ownerId, vaultId, this.database);
    const now = this.now();
    const restored = await this.database.authenticatorAccount.updateMany({
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
  client: Prisma.TransactionClient | PrismaDatabase,
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

function validAccountMigration(migration: EncryptedPayloadMigration, replacement: Uint8Array): boolean {
  return (
    migration.expectedEnvelopeVersion === 1 &&
    migration.replacementEnvelopeVersion === 2 &&
    migration.expectedCiphertextDigest.length === 43 &&
    migration.replacementCiphertextDigest.length === 43 &&
    migration.operationId === migration.replacementCiphertextDigest &&
    replacement.length >= 29 &&
    replacement[0] === 2 &&
    digestString(replacement) === migration.replacementCiphertextDigest
  );
}

function digestString(bytes: Uint8Array): string {
  const digest = sha256Digest(bytes);
  try {
    return toBase64Url(digest);
  } finally {
    digest.fill(0);
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

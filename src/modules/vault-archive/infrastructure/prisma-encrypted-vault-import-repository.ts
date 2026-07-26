import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/prisma-client";
import type { EncryptedVaultImportRepository } from "../application/import-encrypted-vault-archive";
import type { EncryptedVaultImport, EncryptedVaultImportResult } from "../domain/encrypted-vault-import";

export class PrismaEncryptedVaultImportRepository implements EncryptedVaultImportRepository {
  public async import(ownerId: string, request: EncryptedVaultImport): Promise<EncryptedVaultImportResult> {
    try {
      return await prisma.$transaction(async (transaction) => {
        const destination = await lockDestination(transaction, ownerId, request);
        if (request.destination.kind === "EXISTING" && !destination) return { status: "DESTINATION_UNAVAILABLE" };
        if (request.destination.kind === "NEW_SHARED" && destination) {
          return replayResult(transaction, request, true);
        }

        const existingAccounts = request.accounts.length
          ? await transaction.authenticatorAccount.findMany({ where: { id: { in: request.accounts.map(({ id }) => id) } }, select: { id: true, vaultId: true } })
          : [];
        if (existingAccounts.length > 0) {
          if (existingAccounts.length === request.accounts.length && existingAccounts.every(({ vaultId }) => vaultId === request.destination.vaultId)) {
            return { status: "REPLAYED", vaultId: request.destination.vaultId, accountIds: request.accounts.map(({ id }) => id), vaultCreated: request.destination.kind === "NEW_SHARED" };
          }
          return { status: "CONFLICT" };
        }

        if (request.destination.kind === "NEW_SHARED") {
          await transaction.vault.create({
            data: {
              id: request.destination.vaultId,
              ownerId,
              type: "SHARED",
              lifecycle: "ACTIVE",
              encryptedName: copyBytes(request.destination.encryptedName),
              encryptionVersion: request.destination.encryptionVersion,
              members: { create: { userId: ownerId, role: "OWNER", encryptedVaultKey: copyBytes(request.destination.encryptedOwnerVaultKey), keyVersion: 1 } },
              accounts: { create: request.accounts.map((account) => ({ id: account.id, encryptedPayload: copyBytes(account.encryptedPayload), encryptionVersion: account.encryptionVersion })) }
            }
          });
          await transaction.vaultAuditEvent.create({ data: { vaultId: request.destination.vaultId, ownerId, actorUserId: ownerId, eventType: "ARCHIVE_IMPORTED" } });
        } else {
          if (request.accounts.length) {
            await transaction.authenticatorAccount.createMany({ data: request.accounts.map((account) => ({ id: account.id, vaultId: request.destination.vaultId, encryptedPayload: copyBytes(account.encryptedPayload), encryptionVersion: account.encryptionVersion })) });
          }
          if (request.destination.vaultType === "SHARED") await transaction.vaultAuditEvent.create({ data: { vaultId: request.destination.vaultId, ownerId, actorUserId: ownerId, eventType: "ARCHIVE_IMPORTED" } });
        }
        return { status: "IMPORTED", vaultId: request.destination.vaultId, accountIds: request.accounts.map(({ id }) => id), vaultCreated: request.destination.kind === "NEW_SHARED" };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await this.readReplay(ownerId, request);
        return replay ?? { status: "CONFLICT" };
      }
      throw error;
    }
  }

  private async readReplay(ownerId: string, request: EncryptedVaultImport): Promise<EncryptedVaultImportResult | null> {
    const destination = await prisma.vault.findFirst({ where: destinationWhere(ownerId, request), select: { id: true } });
    if (!destination) return null;
    const accounts = request.accounts.length
      ? await prisma.authenticatorAccount.findMany({ where: { id: { in: request.accounts.map(({ id }) => id) }, vaultId: request.destination.vaultId }, select: { id: true } })
      : [];
    if (accounts.length !== request.accounts.length) return null;
    return { status: "REPLAYED", vaultId: request.destination.vaultId, accountIds: request.accounts.map(({ id }) => id), vaultCreated: request.destination.kind === "NEW_SHARED" };
  }
}

async function lockDestination(transaction: Prisma.TransactionClient, ownerId: string, request: EncryptedVaultImport): Promise<{ id: string; type: string } | undefined> {
  const expectedType = request.destination.kind === "NEW_SHARED" ? "SHARED" : request.destination.vaultType;
  const rows = await transaction.$queryRaw<Array<{ id: string; type: string }>>`
    SELECT "id", "type"
    FROM "vaults"
    WHERE "id" = ${request.destination.vaultId}
      AND "owner_id" = ${ownerId}
      AND "type" = ${expectedType}
      AND "lifecycle" = 'ACTIVE'
      AND "deleted_at" IS NULL
    FOR UPDATE
  `;
  return rows[0];
}

function destinationWhere(ownerId: string, request: EncryptedVaultImport) {
  const destination = request.destination;
  return destination.kind === "NEW_SHARED"
    ? { id: destination.vaultId, ownerId, type: "SHARED" as const, lifecycle: "ACTIVE" as const, deletedAt: null }
    : { id: destination.vaultId, ownerId, type: destination.vaultType, lifecycle: "ACTIVE" as const, deletedAt: null };
}

async function replayResult(
  transaction: Prisma.TransactionClient,
  request: EncryptedVaultImport,
  vaultCreated: boolean
): Promise<EncryptedVaultImportResult> {
  const accounts = request.accounts.length
    ? await transaction.authenticatorAccount.findMany({ where: { id: { in: request.accounts.map(({ id }) => id) }, vaultId: request.destination.vaultId }, select: { id: true } })
    : [];
  return accounts.length === request.accounts.length
    ? { status: "REPLAYED", vaultId: request.destination.vaultId, accountIds: request.accounts.map(({ id }) => id), vaultCreated }
    : { status: "CONFLICT" };
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

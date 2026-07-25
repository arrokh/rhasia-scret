import { prisma } from "@/shared/infrastructure/prisma-client";
import { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";

export class PrismaSharedOwnerAccountRepository {
  public async create(ownerId: string, vaultId: string, encryptedPayload: Uint8Array, encryptionVersion: number): Promise<EncryptedAuthenticatorAccount> {
    await assertOwner(ownerId, vaultId);
    const account = await prisma.authenticatorAccount.create({ data: { vaultId, encryptedPayload: copyBytes(encryptedPayload), encryptionVersion } });
    return new EncryptedAuthenticatorAccount(account.id, account.vaultId, account.encryptedPayload, account.encryptionVersion, account.revision);
  }

  public async update(ownerId: string, vaultId: string, accountId: string, expectedRevision: number, encryptedPayload: Uint8Array, encryptionVersion: number): Promise<EncryptedAuthenticatorAccount | null> {
    await assertOwner(ownerId, vaultId);
    const updated = await prisma.authenticatorAccount.updateMany({ where: { id: accountId, vaultId, revision: expectedRevision, deletedAt: null }, data: { encryptedPayload: copyBytes(encryptedPayload), encryptionVersion, revision: { increment: 1 } } });
    if (updated.count !== 1) return null;
    const account = await prisma.authenticatorAccount.findUniqueOrThrow({ where: { id: accountId } });
    return new EncryptedAuthenticatorAccount(account.id, account.vaultId, account.encryptedPayload, account.encryptionVersion, account.revision);
  }
}

async function assertOwner(ownerId: string, vaultId: string): Promise<void> {
  const vault = await prisma.vault.findFirst({ where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null } });
  if (!vault) throw new Error("Shared Vault owner access is required.");
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

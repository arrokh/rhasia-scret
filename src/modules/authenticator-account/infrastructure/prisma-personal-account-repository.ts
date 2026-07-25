import { prisma } from "@/shared/infrastructure/prisma-client";
import { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";
import type { NewEncryptedAccount, PersonalAccountRepository } from "../application/personal-account-repository";

type AccountRecord = {
  id: string;
  vaultId: string;
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
  revision: number;
};

export class PrismaPersonalAccountRepository implements PersonalAccountRepository {
  public async create(ownerId: string, vaultId: string, account: NewEncryptedAccount): Promise<EncryptedAuthenticatorAccount> {
    await assertActivePersonalVault(ownerId, vaultId);
    const created = await prisma.authenticatorAccount.create({
      data: { vaultId, encryptedPayload: copyBytes(account.encryptedPayload), encryptionVersion: account.encryptionVersion }
    });
    return toAccount(created);
  }

  public async list(ownerId: string, vaultId: string): Promise<EncryptedAuthenticatorAccount[]> {
    await assertActivePersonalVault(ownerId, vaultId);
    const accounts = await prisma.authenticatorAccount.findMany({
      where: { vaultId, deletedAt: null },
      orderBy: { createdAt: "asc" }
    });
    return accounts.map(toAccount);
  }
}

async function assertActivePersonalVault(ownerId: string, vaultId: string): Promise<void> {
  const vault = await prisma.vault.findFirst({ where: { id: vaultId, ownerId, type: "PERSONAL", lifecycle: "ACTIVE", deletedAt: null } });
  if (!vault) throw new Error("Personal Vault is unavailable.");
}

function toAccount(record: AccountRecord): EncryptedAuthenticatorAccount {
  return new EncryptedAuthenticatorAccount(record.id, record.vaultId, record.encryptedPayload, record.encryptionVersion, record.revision);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

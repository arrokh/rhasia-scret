import { prisma } from "@/shared/infrastructure/prisma-client";
import { Vault, type VaultLifecycle } from "../domain/vault";
import type { PersonalVaultRepository } from "../application/personal-vault-repository";
import type { PersonalVaultInitialization, PersonalVaultInitializer } from "../application/initialize-personal-vault";

type VaultRecord = {
  id: string;
  type: string;
  ownerId: string;
  lifecycle: string;
};

export class PrismaPersonalVaultRepository implements PersonalVaultRepository, PersonalVaultInitializer {
  public async ensureForOwner(ownerId: string): Promise<Vault> {
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
      const existing = await transaction.vault.findFirst({
        where: { ownerId, type: "PERSONAL" },
        orderBy: { createdAt: "asc" },
      });
      if (existing) return toVault(existing);

      const created = await transaction.vault.create({
        data: {
          ownerId,
          type: "PERSONAL",
          lifecycle: "UNINITIALIZED",
          encryptionVersion: 1,
          members: { create: { userId: ownerId, role: "OWNER" } },
        },
      });
      return toVault(created);
    });
  }

  public async initialize(ownerId: string, initialization: PersonalVaultInitialization): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
      const vault = await transaction.vault.findFirst({
        where: { ownerId, type: "PERSONAL" },
        orderBy: { createdAt: "asc" },
      });
      if (!vault) throw new Error("Personal Vault does not exist.");
      if (vault.lifecycle !== "UNINITIALIZED") throw new Error("Personal Vault is already initialized.");

      await transaction.userCryptoProfile.create({
        data: {
          userId: ownerId,
          vaultUnlockSalt: copyBytes(initialization.vaultUnlockSalt),
          wrappedUserRootKey: copyBytes(initialization.wrappedUserRootKey),
          rootKeyWrappingVersion: initialization.encryptionVersion,
          encryptedPersonalVaultKey: copyBytes(initialization.encryptedPersonalVaultKey),
          personalVaultKeyEncryptionVersion: initialization.encryptionVersion,
        },
      });
      await transaction.vault.update({
        where: { id: vault.id },
        data: {
          encryptedName: copyBytes(initialization.encryptedVaultName),
          encryptionVersion: initialization.encryptionVersion,
          lifecycle: "ACTIVE",
        },
      });
    });
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function toVault(record: VaultRecord): Vault {
  if (record.type !== "PERSONAL" && record.type !== "SHARED") throw new Error("Vault has an invalid type.");
  if (record.lifecycle !== "UNINITIALIZED" && record.lifecycle !== "ACTIVE") {
    throw new Error("Vault has an invalid lifecycle.");
  }
  return new Vault(record.id, record.type, record.ownerId, record.lifecycle as VaultLifecycle);
}

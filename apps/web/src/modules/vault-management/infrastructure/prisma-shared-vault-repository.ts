import { prisma } from "@/shared/infrastructure/prisma-client";
import { Vault } from "../domain/vault";
import type { NewSharedVault, SharedVaultRepository } from "../application/shared-vault-repository";

export class PrismaSharedVaultRepository implements SharedVaultRepository {
  public async create(ownerId: string, vault: NewSharedVault): Promise<Vault> {
    const created = await prisma.vault.create({
      data: {
        ...(vault.id ? { id: vault.id } : {}),
        ownerId,
        type: "SHARED",
        lifecycle: "ACTIVE",
        encryptedName: copyBytes(vault.encryptedName),
        encryptionVersion: vault.encryptionVersion,
        members: {
          create: {
            userId: ownerId,
            role: "OWNER",
            encryptedVaultKey: copyBytes(vault.encryptedOwnerVaultKey),
            keyVersion: vault.encryptionVersion
          }
        }
      }
    });
    return new Vault(created.id, "SHARED", created.ownerId, "ACTIVE");
  }

  public async rename(ownerId: string, vaultId: string, encryptedName: Uint8Array, encryptionVersion: number): Promise<boolean> {
    const result = await prisma.vault.updateMany({
      where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null },
      data: { encryptedName: copyBytes(encryptedName), encryptionVersion }
    });
    return result.count === 1;
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

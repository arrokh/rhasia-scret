import { prisma } from "@/shared/infrastructure/prisma-client";

export type VaultKeyRotation = {
  encryptedName: Uint8Array;
  encryptionVersion: number;
  keyVersion: number;
  accounts: Array<{ id: string; encryptedPayload: Uint8Array }>;
  memberPackages: Array<{ userId: string; encryptedVaultKey: Uint8Array }>;
};

export class PrismaVaultKeyRotationRepository {
  public async rotate(ownerId: string, vaultId: string, rotation: VaultKeyRotation): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const vault = await tx.vault.findFirst({ where: { id: vaultId, ownerId, type: "SHARED", lifecycle: "ACTIVE", deletedAt: null }, include: { members: { where: { status: "ACTIVE" }, select: { userId: true } }, accounts: { where: { deletedAt: null }, select: { id: true } } } });
      if (!vault || !sameIds(vault.members.map((member) => member.userId), rotation.memberPackages.map((member) => member.userId)) || !sameIds(vault.accounts.map((account) => account.id), rotation.accounts.map((account) => account.id))) return false;
      await tx.vault.update({ where: { id: vaultId }, data: { encryptedName: copyBytes(rotation.encryptedName), encryptionVersion: rotation.encryptionVersion } });
      await Promise.all(rotation.memberPackages.map((member) => tx.vaultMember.update({ where: { vaultId_userId: { vaultId, userId: member.userId } }, data: { encryptedVaultKey: copyBytes(member.encryptedVaultKey), keyVersion: rotation.keyVersion } })));
      await Promise.all(rotation.accounts.map((account) => tx.authenticatorAccount.update({ where: { id: account.id }, data: { encryptedPayload: copyBytes(account.encryptedPayload), revision: { increment: 1 } } })));
      return true;
    });
  }
}

function sameIds(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length && expected.every((id) => actual.includes(id));
}
function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> { const copy = new Uint8Array(bytes.length); copy.set(bytes); return copy; }

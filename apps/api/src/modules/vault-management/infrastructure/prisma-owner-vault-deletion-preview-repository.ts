import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import type {
  OwnerVaultDeletionPreview,
  OwnerVaultDeletionPreviewRepository,
} from "../application/owner-vault-deletion-preview";

export class PrismaOwnerVaultDeletionPreviewRepository implements OwnerVaultDeletionPreviewRepository {
  public constructor(private readonly database: PrismaDatabase) {}

  public async getForOwner(ownerId: string): Promise<OwnerVaultDeletionPreview> {
    const [personalVault, sharedVaults] = await Promise.all([
      this.database.vault.findFirst({
        where: { ownerId, type: "PERSONAL" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      }),
      this.database.vault.findMany({
        where: { ownerId, type: "SHARED" },
        select: {
          id: true,
          lifecycle: true,
          members: {
            where: { role: "VIEWER", status: "ACTIVE", user: { status: "ACTIVE" } },
            select: { userId: true, user: { select: { email: true } }, encryptedVaultKey: true, keyVersion: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      personalVaultId: personalVault?.id ?? null,
      ownedSharedVaults: sharedVaults.map((vault) => ({
        id: vault.id,
        lifecycle: vault.lifecycle,
        viewerCandidates:
          vault.lifecycle === "ACTIVE"
            ? vault.members.flatMap((member) =>
                member.encryptedVaultKey &&
                member.encryptedVaultKey.byteLength > 0 &&
                member.keyVersion !== null &&
                member.keyVersion !== 0
                  ? [{ id: member.userId, email: member.user.email }]
                  : [],
              )
            : [],
      })),
    };
  }
}

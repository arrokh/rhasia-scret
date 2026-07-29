import { prisma } from "@/shared/infrastructure/prisma-client";
import { measureServerOperation } from "@/shared/infrastructure/server-performance";
import type { ApplicationUserStatus } from "@/modules/identity";
import type { VaultLifecycle } from "../domain/vault";
import type { ExistingVaultPageContext, VaultPageContextReader } from "../application/vault-page-context";

export class PrismaVaultPageContextReader implements VaultPageContextReader {
  public async findByExternalIdentity(issuer: string, subject: string): Promise<ExistingVaultPageContext | null> {
    const record = await measureServerOperation("rhsia:server:vault-page-context", () => prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
      select: {
        applicationUser: {
          select: {
            id: true,
            email: true,
            status: true,
            ownedVaults: {
              where: { type: "PERSONAL" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { id: true, lifecycle: true }
            }
          }
        }
      }
    }));
    if (!record) return null;
    const userRecord = record.applicationUser;
    if (userRecord.status !== "ACTIVE" && userRecord.status !== "INACTIVE") throw new Error("Application user has an invalid status.");
    const personalVault = userRecord.ownedVaults[0];
    if (personalVault && personalVault.lifecycle !== "UNINITIALIZED" && personalVault.lifecycle !== "ACTIVE") {
      throw new Error("Personal Vault has an invalid lifecycle.");
    }
    return {
      user: {
        id: userRecord.id,
        email: userRecord.email,
        status: userRecord.status as ApplicationUserStatus
      },
      personalVault: personalVault ? {
        id: personalVault.id,
        lifecycle: personalVault.lifecycle as VaultLifecycle
      } : null
    };
  }
}

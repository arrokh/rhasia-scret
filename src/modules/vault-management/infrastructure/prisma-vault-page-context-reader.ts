import { prisma } from "@/shared/infrastructure/prisma-client";
import { measureServerOperation } from "@/shared/infrastructure/server-performance";
import type { ApplicationUserStatus } from "@/modules/identity";
import type { VaultLifecycle } from "../domain/vault";
import type { ExistingVaultPageContext, VaultPageContextReader } from "../application/vault-page-context";

export class PrismaVaultPageContextReader implements VaultPageContextReader {
  public async findBySessionSubject(subject: string): Promise<ExistingVaultPageContext | null> {
    const record = await measureServerOperation("rhsia:server:vault-page-context", () => prisma.applicationUser.findUnique({
      where: { supabaseUserId: subject },
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
    }));
    if (!record) return null;
    if (record.status !== "ACTIVE" && record.status !== "INACTIVE") throw new Error("Application user has an invalid status.");
    const personalVault = record.ownedVaults[0];
    if (personalVault && personalVault.lifecycle !== "UNINITIALIZED" && personalVault.lifecycle !== "ACTIVE") {
      throw new Error("Personal Vault has an invalid lifecycle.");
    }
    return {
      user: {
        id: record.id,
        email: record.email,
        status: record.status as ApplicationUserStatus
      },
      personalVault: personalVault ? {
        id: personalVault.id,
        lifecycle: personalVault.lifecycle as VaultLifecycle
      } : null
    };
  }
}

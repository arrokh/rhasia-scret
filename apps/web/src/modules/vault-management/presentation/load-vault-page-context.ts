import { cache } from "react";
import { redirect } from "next/navigation";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { resolveVaultPageContext } from "@/modules/vault-management/application/vault-page-context";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { PrismaVaultPageContextReader } from "@/modules/vault-management/infrastructure/prisma-vault-page-context-reader";

const readVaultPageContext = cache(() =>
  resolveVaultPageContext(
    createSessionVerifier(),
    createApplicationUserRepository(),
    new PrismaPersonalVaultRepository(),
    new PrismaVaultPageContextReader(),
  ),
);

export async function loadVaultPageContext() {
  const context = await readVaultPageContext();
  if (!context || context.user.status !== "ACTIVE") redirect("/sign-in");
  return context;
}

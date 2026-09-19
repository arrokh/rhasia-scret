import { cache } from "react";
import { redirect } from "next/navigation";
import { loadServerVaultPageContext } from "@/shared/infrastructure/server-api-gateway";

const readVaultPageContext = cache(loadServerVaultPageContext);

export async function loadVaultPageContext() {
  const context = await readVaultPageContext();
  if (!context || context.user.status !== "ACTIVE") redirect("/sign-in");
  return context;
}

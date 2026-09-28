import { cache } from "react";
import { redirect } from "next/navigation";
import {
  isServerApiConfigurationError,
  isServerApiUnavailableError,
  loadServerVaultPageContext,
} from "@/shared/infrastructure/server-api-gateway";

const readVaultPageContext = cache(loadServerVaultPageContext);

export async function loadVaultPageContext() {
  let context: Awaited<ReturnType<typeof loadServerVaultPageContext>>;
  try {
    context = await readVaultPageContext();
  } catch (error) {
    if (isServerApiConfigurationError(error)) redirect("/sign-in?auth=configuration_error");
    if (isServerApiUnavailableError(error)) redirect("/sign-in?auth=service_unavailable");
    throw error;
  }
  if (!context || context.user.status !== "ACTIVE") redirect("/sign-in");
  return context;
}

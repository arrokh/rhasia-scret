import { redirect } from "next/navigation";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import { AccountDeletionPage } from "@/modules/account-deletion";
import {
  isServerApiConfigurationError,
  isServerApiUnavailableError,
  loadServerAccountDeletionContext,
} from "@/shared/infrastructure/server-api-gateway";

export const dynamic = "force-dynamic";

export default async function AccountDeletePage() {
  let context: Awaited<ReturnType<typeof loadServerAccountDeletionContext>>;
  try {
    context = await loadServerAccountDeletionContext();
  } catch (error) {
    if (isServerApiConfigurationError(error)) redirect("/sign-in?auth=configuration_error");
    if (isServerApiUnavailableError(error)) redirect("/sign-in?auth=service_unavailable");
    throw error;
  }
  if (!context) redirect("/sign-in");
  return (
    <UnlockedVaultWorkspaceProvider>
      <AccountDeletionPage email={context.email} />
    </UnlockedVaultWorkspaceProvider>
  );
}

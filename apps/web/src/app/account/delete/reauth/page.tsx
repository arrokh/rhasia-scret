import { redirect } from "next/navigation";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import { AccountDeletionPage } from "@/modules/account-deletion";
import { loadServerAccountDeletionContext } from "@/shared/infrastructure/server-api-gateway";

export const dynamic = "force-dynamic";

export default async function AccountDeleteReauthenticationPage() {
  const context = await loadServerAccountDeletionContext();
  if (!context) redirect("/sign-in");
  return (
    <UnlockedVaultWorkspaceProvider>
      <AccountDeletionPage email={context.email} authBackend={context.authBackend} initialReauthenticated />
    </UnlockedVaultWorkspaceProvider>
  );
}

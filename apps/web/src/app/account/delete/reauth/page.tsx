import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import { AccountDeletionPage } from "@/modules/account-deletion";
import { loadAccountDeletionPageContext } from "@/modules/account-deletion/server";

export const dynamic = "force-dynamic";

export default async function AccountDeleteReauthenticationPage() {
  const context = await loadAccountDeletionPageContext();
  return (
    <UnlockedVaultWorkspaceProvider>
      <AccountDeletionPage email={context.email} authBackend={context.authBackend} initialReauthenticated />
    </UnlockedVaultWorkspaceProvider>
  );
}

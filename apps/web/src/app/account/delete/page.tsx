import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import { AccountDeletionPage } from "@/modules/account-deletion";
import { loadAccountDeletionPageContext } from "@/modules/account-deletion/server";

export const dynamic = "force-dynamic";

export default async function AccountDeletePage({ searchParams }: { searchParams: Promise<{ reauth?: string }> }) {
  const [context, params] = await Promise.all([loadAccountDeletionPageContext(), searchParams]);
  return (
    <UnlockedVaultWorkspaceProvider>
      <AccountDeletionPage
        email={context.email}
        authBackend={context.authBackend}
        initialReauthenticated={params.reauth === "success"}
      />
    </UnlockedVaultWorkspaceProvider>
  );
}

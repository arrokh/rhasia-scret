import { redirect } from "next/navigation";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";
import { AccountDeletionPage } from "@/modules/account-deletion";
import { loadServerAccountDeletionContext } from "@/shared/infrastructure/server-api-gateway";

export const dynamic = "force-dynamic";

export default async function AccountDeletePage({ searchParams }: { searchParams: Promise<{ reauth?: string }> }) {
  const [context, params] = await Promise.all([loadServerAccountDeletionContext(), searchParams]);
  if (!context) redirect("/sign-in");
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

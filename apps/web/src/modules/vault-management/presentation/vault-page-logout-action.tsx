import { loadVaultPageContext } from "./load-vault-page-context";
import { VaultPageAccountMenu } from "./vault-page-account-menu";

export async function VaultPageLogoutAction() {
  const { user } = await loadVaultPageContext();
  return <VaultPageAccountMenu email={user.email} />;
}

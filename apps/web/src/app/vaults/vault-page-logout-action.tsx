import { loadVaultPageContext } from "./load-vault-page-context";
import { PostHogIdentify, VaultPageAccountMenu } from "./vault-page-account-menu";

export async function VaultPageLogoutAction() {
  const { user } = await loadVaultPageContext();
  return <><PostHogIdentify userId={user.id} /><VaultPageAccountMenu email={user.email} /></>;
}

import { LogoutForm } from "@/modules/identity";
import { loadVaultPageContext } from "./load-vault-page-context";

export async function VaultPageLogoutAction() {
  const { user } = await loadVaultPageContext();
  return <LogoutForm email={user.email} />;
}

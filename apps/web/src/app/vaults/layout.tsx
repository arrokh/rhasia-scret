import type { ReactNode } from "react";
import { UnlockedVaultWorkspaceProvider } from "@/modules/authenticator-account";

export default function VaultsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <UnlockedVaultWorkspaceProvider>{children}</UnlockedVaultWorkspaceProvider>;
}

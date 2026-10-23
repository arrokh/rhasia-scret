import { pendingVaultSensitiveOperations } from "./browser-vault-lock";

export function waitForPendingVaultSensitiveOperations(): Promise<void> {
  return Promise.allSettled(pendingVaultSensitiveOperations).then(() => undefined);
}

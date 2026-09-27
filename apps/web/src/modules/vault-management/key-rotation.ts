/** Public entry point for browser-only Vault Encryption Key rotation workflows. */
export {
  prepareBrowserVaultKeyRotation,
  reconcilePreparedBrowserVaultKeyRotation,
  submitPreparedBrowserVaultKeyRotation,
} from "./infrastructure/browser-vault-key-rotation-workflow";
export type {
  PreparedVaultKeyRotation,
  VaultKeyRotationOutcome,
} from "./infrastructure/browser-vault-key-rotation-workflow";

export {
  LEGACY_LOCAL_VAULT_RECORD_VERSION,
  LOCAL_VAULT_ENCRYPTION_VERSION,
  LOCAL_VAULT_RECORD_VERSION,
  parseLocalVaultRecord,
} from "./domain/local-vault-record";
export type {
  EncryptedLocalVaultAccount,
  LocalVaultKdfParameters,
  LocalVaultRecord,
} from "./domain/local-vault-record";
export type { LocalVaultCapabilityPort } from "./application/local-vault-capabilities";
export {
  LocalVaultSession,
  LocalVaultSessionDisposedError,
  LocalVaultSessionLockedError,
} from "./application/local-vault-session";
export type { LocalVaultSessionPorts, LocalVaultSessionState } from "./application/local-vault-session";
export {
  addLocalAccount as addLocalAccountWithPorts,
  createLocalVault as createLocalVaultWithPorts,
  deleteLocalAccount as deleteLocalAccountWithPorts,
  exportLocalVault as exportLocalVaultWithPorts,
  importLocalVaultArchive as importLocalVaultArchiveWithPorts,
  migrateLegacyLocalVault as migrateLegacyLocalVaultWithPorts,
  previewLocalVaultArchive as previewLocalVaultArchiveWithPorts,
  previewLocalVaultArchiveImport as previewLocalVaultArchiveImportWithPorts,
  recordLocalArchiveExport as recordLocalArchiveExportWithPorts,
  refreshUnlockedLocalVault as refreshUnlockedLocalVaultWithPorts,
  renameLocalVault as renameLocalVaultWithPorts,
  unlockLocalVault as unlockLocalVaultWithPorts,
  updateLocalAccount as updateLocalAccountWithPorts,
} from "./application/local-vault-workflow";
export type { LocalVaultRepository } from "./application/local-vault-repository";
export type {
  LocalVaultAccountPayloadPort,
  LocalVaultCryptoPort,
  LocalVaultWorkflowDependencies,
} from "./application/local-vault-workflow-ports";
export {
  BrowserLocalVaultCapabilities,
  BrowserLocalVaultRepository,
  browserLocalVaultCapabilities,
  clearLocalVault,
  readLocalVaultRecord,
} from "./infrastructure/browser-local-vault-repository";
export { createBrowserLocalVaultSession } from "./infrastructure/browser-local-vault-session";
export {
  addLocalAccount,
  clearUnlockedLocalVault,
  createLocalVault,
  deleteLocalAccount,
  exportLocalVault,
  importLocalVaultArchive,
  migrateLegacyLocalVault,
  previewLocalVaultArchive,
  previewLocalVaultArchiveImport,
  recordLocalArchiveExport,
  refreshUnlockedLocalVault,
  renameLocalVault,
  unlockLocalVault,
  updateLocalAccount,
} from "./infrastructure/browser-local-vault-workflow";
export { LocalVaultMigrationRequiredError } from "./infrastructure/browser-local-vault-workflow";
export type {
  LocalVaultArchiveImportReview,
  UnlockedLocalVault,
  UnlockedLocalVaultAccount,
} from "./infrastructure/browser-local-vault-workflow";
export { LocalVaultCopyPanel } from "./presentation/local-vault-copy-panel";

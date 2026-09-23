export type { OfflineSyncBundleReader } from "./application/offline-sync-bundle-reader";
export {
  AUTHORIZED_WORKSPACE_RESPONSE_VERSION,
  LegacySharedVaultSnapshotError,
  OFFLINE_BUNDLE_SCHEMA_VERSION,
  parseAuthorizedWorkspaceResponse,
  parseEncryptedOnlineWorkspaceBundle,
  parseEncryptedPersonalOfflineSnapshot,
} from "@rhasia-scret/client-vault-core";
export type {
  AuthorizedWorkspaceResponse,
  EncryptedOfflineAccount,
  EncryptedOfflinePersonalVault,
  EncryptedOnlineSharedVault,
  EncryptedOnlineWorkspaceBundle,
  EncryptedPersonalOfflineSnapshot,
} from "@rhasia-scret/client-vault-core";
export { isReadOnlySyncState, nextOfflineSyncState } from "@rhasia-scret/client-vault-core";
export type { OfflineSyncEvent, OfflineSyncState } from "@rhasia-scret/client-vault-core";
export { AuthorizedWorkspaceTransportError } from "@rhasia-scret/client-vault-core";
export { canMutateVault, resolveVaultStatus } from "@rhasia-scret/client-vault-core";
export type {
  VaultCapability,
  VaultOrigin,
  VaultStatus,
  VaultStatusInput,
  VaultStatusKind,
} from "@rhasia-scret/client-vault-core";
export {
  BrowserOfflineVaultRepository,
  clearAllOfflineVaultData,
} from "./infrastructure/browser-offline-vault-repository";
export type { OfflineProfileSummary } from "./infrastructure/browser-offline-vault-repository";
export type {
  ClientStoragePort,
  OfflineVaultSnapshotStore,
  RememberedBrowserPackage,
  RememberedBrowserStore,
  VaultLockPort,
} from "@rhasia-scret/client-vault-core";
export { fetchAuthorizedWorkspaceBundle } from "./infrastructure/browser-offline-sync-client";
export {
  classifyBrowserVaultWorkspaceUnlockFailure,
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser,
  loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser,
  refreshUnlockedVaultWorkspace,
  LocalStorageSyncError,
} from "./infrastructure/browser-vault-workspace";
export type {
  BrowserVaultWorkspaceUnlockFailure,
  UnlockedVaultWorkspace,
  WorkspaceAuthenticatorAccount,
} from "./infrastructure/browser-vault-workspace";
export {
  classifyBrowserWorkspaceRefreshFailure,
  createBrowserWorkspaceLifecyclePorts,
} from "./infrastructure/browser-workspace-lifecycle";
export {
  browserVaultLockPort,
  requestLocalVaultLock,
  subscribeToLocalVaultLock,
} from "./infrastructure/browser-vault-lock";
export { VaultStatusIndicator } from "./presentation/vault-status-indicator";
export { useWorkspaceLifecycle } from "./presentation/use-workspace-lifecycle";
export type { BrowserWorkspaceLifecycle } from "./presentation/use-workspace-lifecycle";

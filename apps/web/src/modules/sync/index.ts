export type { OfflineSyncBundleReader } from "./application/offline-sync-bundle-reader";
export { OFFLINE_BUNDLE_SCHEMA_VERSION, parseEncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";
export type {
  EncryptedOfflineAccount,
  EncryptedOfflinePersonalVault,
  EncryptedOfflineSharedVault,
  EncryptedOfflineVaultBundle,
} from "@rhasia-scret/client-vault-core";
export { isReadOnlySyncState, nextOfflineSyncState } from "@rhasia-scret/client-vault-core";
export type { OfflineSyncEvent, OfflineSyncState } from "@rhasia-scret/client-vault-core";
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
export { fetchAuthorizedOfflineBundle } from "./infrastructure/browser-offline-sync-client";
export {
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser,
  loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser,
  refreshUnlockedVaultWorkspace,
  LocalStorageSyncError,
} from "./infrastructure/browser-vault-workspace";
export type { UnlockedVaultWorkspace, WorkspaceAuthenticatorAccount } from "./infrastructure/browser-vault-workspace";
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

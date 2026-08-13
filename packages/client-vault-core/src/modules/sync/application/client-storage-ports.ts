import type { EncryptedOfflineVaultBundle } from "../domain/offline-vault-bundle";
import type { PortDisposer } from "../../../shared/application/platform-ports";

export type RememberedBrowserPackage = {
  version: 1;
  profileId: string;
  rpId: string;
  origin: string;
  credentialId: string;
  encryptedUserRootKeyPackage: string;
  enrolledAt: string;
};

export interface OfflineVaultSnapshotStore {
  listProfiles(): Promise<Array<{ profileId: string; personalVaultId: string; synchronizedAt: string; sharedVaultCount: number }>>;
  read(profileId: string): Promise<EncryptedOfflineVaultBundle | null>;
  readByPersonalVaultId(personalVaultId: string): Promise<EncryptedOfflineVaultBundle | null>;
  replace(bundle: EncryptedOfflineVaultBundle): Promise<void>;
  removeVault(profileId: string, vaultId: string): Promise<void>;
  removeProfile(profileId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface RememberedBrowserStore {
  saveRememberedBrowser(packageInput: RememberedBrowserPackage): Promise<void>;
  readRememberedBrowser(profileId: string): Promise<RememberedBrowserPackage | null>;
  removeRememberedBrowser(profileId: string): Promise<void>;
}

export interface ClientStoragePort extends OfflineVaultSnapshotStore, RememberedBrowserStore {}

export interface VaultLockPort {
  requestLock(): void;
  subscribe(listener: () => void): PortDisposer;
}

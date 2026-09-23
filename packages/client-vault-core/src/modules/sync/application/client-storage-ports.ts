import type { EncryptedPersonalOfflineSnapshot } from "../domain/offline-vault-bundle";
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

export type OfflineProfileSummary = {
  profileId: string;
  personalVaultId: string;
  synchronizedAt: string;
  sharedVaultCount: 0;
};

export type OfflineProfileDiscovery = {
  profiles: OfflineProfileSummary[];
  migrationRequired: boolean;
};

export interface OfflineVaultSnapshotStore {
  listProfiles(): Promise<OfflineProfileDiscovery>;
  read(profileId: string): Promise<EncryptedPersonalOfflineSnapshot | null>;
  readByPersonalVaultId(personalVaultId: string): Promise<EncryptedPersonalOfflineSnapshot | null>;
  replace(bundle: EncryptedPersonalOfflineSnapshot): Promise<void>;
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

"use client";

import { trackVaultSensitiveOperation } from "@/modules/sync";
import { LocalVaultSession } from "../application/local-vault-session";
import { BrowserLocalVaultRepository, browserLocalVaultCapabilities } from "./browser-local-vault-repository";
import {
  clearUnlockedLocalVault,
  createLocalVault,
  LocalVaultMigrationRequiredError,
  migrateLegacyLocalVault,
  refreshUnlockedLocalVault,
  unlockLocalVault,
} from "./browser-local-vault-workflow";

export function createBrowserLocalVaultSession(): LocalVaultSession {
  const repository = new BrowserLocalVaultRepository();
  return new LocalVaultSession({
    isAvailable: () => browserLocalVaultCapabilities.isAvailable(),
    readRecord: () => repository.read(),
    readArchiveExportAt: (profileId) => repository.readArchiveExportAt(profileId),
    clearOrphanedArchiveExportMarker: () => repository.clearOrphanedArchiveExportMarker(),
    trackSensitiveOperation: trackVaultSensitiveOperation,
    createRecord: createLocalVault,
    persistCreatedRecord: (record) => repository.create(record),
    unlockRecord: unlockLocalVault,
    migrateRecord: migrateLegacyLocalVault,
    refreshVault: refreshUnlockedLocalVault,
    clearRecord: () => repository.clear(),
    clearVault: clearUnlockedLocalVault,
    isMigrationRequired: (error) => error instanceof LocalVaultMigrationRequiredError,
  });
}

"use client";

import {
  decryptPayload,
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser,
  rewrapUserCryptoProfile,
  unlockPersonalVault,
  type EncryptedPersonalVaultProfile,
  unlockPersonalVaultWithUserRootKey
} from "@/modules/crypto";
import {
  BrowserOfflineVaultRepository,
  fetchAuthorizedOfflineBundle,
  type EncryptedOfflineVaultBundle,
  type OfflineSyncState
} from "@/modules/sync";
import { unlockSharedVault, type EffectiveSharedVaultAccountPermissions } from "@/modules/vault-membership";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { measureBrowserOperation } from "@/shared/infrastructure/browser-performance";
import { decryptAccountConfiguration, type DecryptedAuthenticatorAccount } from "./browser-account-payload";

export type UnlockedVault = {
  id: string;
  name: string;
  type: "PERSONAL" | "SHARED";
  role: "OWNER" | "VIEWER";
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  key: Uint8Array;
};

export type WorkspaceAuthenticatorAccount = DecryptedAuthenticatorAccount & {
  id: string;
  vaultId: string;
  vaultName: string;
  vaultType: "PERSONAL" | "SHARED";
  revision: number;
};

export type UnavailableWorkspaceAuthenticatorAccount = {
  id: string;
  vaultId: string;
  vaultName: string;
  vaultType: "PERSONAL" | "SHARED";
  revision: number;
};

export class LocalStorageSyncError extends Error {
  public constructor(cause?: unknown) {
    super("Local encrypted snapshot storage failed.", { cause });
    this.name = "LocalStorageSyncError";
  }
}

export type UnlockedVaultWorkspace = {
  profileId: string;
  synchronizedAt: string;
  synchronizationToken: string;
  syncState: OfflineSyncState;
  userRootKey: Uint8Array;
  vaults: UnlockedVault[];
  accounts: WorkspaceAuthenticatorAccount[];
  unavailableAccounts: UnavailableWorkspaceAuthenticatorAccount[];
  unavailableSharedVaults: number;
};

export async function loadUnlockedVaultWorkspace(
  vaultUnlockSecret: string,
  personalVaultId: string
): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchMeasuredAuthorizedOfflineBundle({ personalVaultId });
  assertPersonalVault(bundle, personalVaultId);
  const unlocked = await unlockPersonalVault(vaultUnlockSecret, profileMaterial(bundle));
  return decryptAndPersistOnlineBundle(bundle, unlocked.userRootKey, unlocked.personalVaultKey, unlocked.migratedProfile);
}

export async function loadUnlockedVaultWorkspaceWithRememberedBrowser(personalVaultId: string, signal?: AbortSignal): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchMeasuredAuthorizedOfflineBundle({ personalVaultId });
  assertPersonalVault(bundle, personalVaultId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await recoverUserRootKeyWithRememberedBrowser(bundle.profileId, signal);
    personalVaultKey = await unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    if (signal?.aborted) throw new DOMException("Remembered Browser unlock was cancelled.", "AbortError");
    return await decryptAndPersistOnlineBundle(bundle, userRootKey, personalVaultKey);
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function loadUnlockedVaultWorkspaceWithPasskey(personalVaultId: string): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchMeasuredAuthorizedOfflineBundle({ personalVaultId });
  assertPersonalVault(bundle, personalVaultId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await recoverUserRootKeyWithPasskey();
    personalVaultKey = await unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    return await decryptAndPersistOnlineBundle(bundle, userRootKey, personalVaultKey);
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function loadOfflineVaultWorkspace(
  profileId: string,
  vaultUnlockSecret: string
): Promise<UnlockedVaultWorkspace> {
  const bundle = await loadLocalBundle(profileId);
  const unlocked = await unlockPersonalVault(vaultUnlockSecret, profileMaterial(bundle));
  try {
    const migratedBundle = unlocked.migratedProfile ? withMigratedProfile(bundle, unlocked.migratedProfile) : bundle;
    if (unlocked.migratedProfile) await new BrowserOfflineVaultRepository().replace(migratedBundle);
    return await loadWorkspace(migratedBundle, unlocked.userRootKey, unlocked.personalVaultKey, navigator.onLine ? "STALE" : "OFFLINE");
  } catch (error) {
    unlocked.userRootKey.fill(0);
    unlocked.personalVaultKey.fill(0);
    throw error;
  }
}

export async function loadOfflineVaultWorkspaceWithRememberedBrowser(profileId: string): Promise<UnlockedVaultWorkspace> {
  const bundle = await loadLocalBundle(profileId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await recoverUserRootKeyWithRememberedBrowser(profileId);
    personalVaultKey = await unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    return await loadWorkspace(bundle, userRootKey, personalVaultKey, navigator.onLine ? "STALE" : "OFFLINE");
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function refreshUnlockedVaultWorkspace(userRootKey: Uint8Array, expectedProfileId: string): Promise<UnlockedVaultWorkspace> {
  const retainedUserRootKey = userRootKey.slice();
  try {
    const bundle = await fetchMeasuredAuthorizedOfflineBundle({ profileId: expectedProfileId });
    if (bundle.profileId !== expectedProfileId) throw new Error("The authenticated profile does not match the unlocked Local Vault Snapshot.");
    const personalVaultKey = await unlockPersonalVaultWithUserRootKey(retainedUserRootKey, profileMaterial(bundle));
    return await decryptAndPersistOnlineBundle(bundle, retainedUserRootKey, personalVaultKey);
  } catch (error) {
    retainedUserRootKey.fill(0);
    throw error;
  }
}

export function clearUnlockedVaultWorkspace(workspace: UnlockedVaultWorkspace | null): void {
  if (!workspace) return;
  workspace.userRootKey.fill(0);
  for (const vault of workspace.vaults) vault.key.fill(0);
  for (const account of workspace.accounts) account.secret.fill(0);
}

async function decryptAndPersistOnlineBundle(
  bundle: EncryptedOfflineVaultBundle,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array,
  migratedProfile?: EncryptedPersonalVaultProfile
): Promise<UnlockedVaultWorkspace> {
  let workspace: UnlockedVaultWorkspace | undefined;
  const persistedBundle = migratedProfile ? withMigratedProfile(bundle, migratedProfile) : bundle;
  const migration = migratedProfile
    ? rewrapUserCryptoProfile({
      vaultUnlockSalt: bytesToBase64(migratedProfile.vaultUnlockSalt),
      wrappedUserRootKey: bytesToBase64(migratedProfile.wrappedUserRootKey),
      encryptedPersonalVaultKey: bytesToBase64(migratedProfile.encryptedPersonalVaultKey),
      encryptionVersion: migratedProfile.encryptionVersion
    })
    : Promise.resolve();
  const persistence = measureBrowserOperation("rhsia:unlock:persist", () => new BrowserOfflineVaultRepository().replace(persistedBundle))
    .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  try {
    workspace = await measureBrowserOperation("rhsia:unlock:decrypt", () => loadWorkspace(bundle, userRootKey, personalVaultKey, "CURRENT"));
    await migration;
    const persisted = await persistence;
    if (!persisted.ok) throw new LocalStorageSyncError(persisted.error);
    return workspace;
  } catch (error) {
    await Promise.allSettled([migration, persistence]);
    if (workspace) clearUnlockedVaultWorkspace(workspace);
    else { userRootKey.fill(0); personalVaultKey.fill(0); }
    throw error;
  }
}

async function loadWorkspace(
  bundle: EncryptedOfflineVaultBundle,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array,
  syncState: OfflineSyncState
): Promise<UnlockedVaultWorkspace> {
  const personalVault: UnlockedVault = {
    id: bundle.personalVault.vaultId,
    name: await decryptName(personalVaultKey, bundle.personalVault.encryptedName, { purpose: "vault-name", payloadType: "vault-name", keyVersion: bundle.cryptoProfile.encryptionVersion }),
    type: "PERSONAL",
    role: "OWNER",
    effectiveAccountPermissions: {
      permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
      sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" }
    },
    key: personalVaultKey
  };
  const personalAccountResult = await decryptAccounts(bundle.personalVault.accounts, personalVault);
  const sharedResults = await Promise.allSettled(bundle.sharedVaults.map(async (encryptedVault) => {
    const unlocked = await unlockSharedVault(
      userRootKey,
      base64ToBytes(encryptedVault.encryptedVaultKey),
      base64ToBytes(encryptedVault.encryptedName),
      encryptedVault.vaultId
    );
    const vault: UnlockedVault = {
      id: encryptedVault.vaultId,
      name: unlocked.name,
      type: "SHARED",
      role: encryptedVault.role,
      effectiveAccountPermissions: encryptedVault.effectiveAccountPermissions,
      key: unlocked.vaultKey
    };
    try {
      return { vault, accountResult: await decryptAccounts(encryptedVault.accounts, vault) };
    } catch (error) {
      vault.key.fill(0);
      throw error;
    }
  }));
  const sharedWorkspaces = sharedResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const vaults = [personalVault, ...sharedWorkspaces.map(({ vault }) => vault)];
  const accounts = sortWorkspaceAccounts([
    ...personalAccountResult.accounts,
    ...sharedWorkspaces.flatMap(({ accountResult }) => accountResult.accounts)
  ]);
  const unavailableAccounts = [
    ...personalAccountResult.unavailableAccounts,
    ...sharedWorkspaces.flatMap(({ accountResult }) => accountResult.unavailableAccounts)
  ];
  return {
    profileId: bundle.profileId,
    synchronizedAt: bundle.synchronizedAt,
    synchronizationToken: bundle.synchronizationToken,
    syncState,
    userRootKey,
    vaults,
    accounts,
    unavailableAccounts,
    unavailableSharedVaults: sharedResults.length - sharedWorkspaces.length
  };
}

function fetchMeasuredAuthorizedOfflineBundle(identifier: { personalVaultId?: string; profileId?: string }): Promise<EncryptedOfflineVaultBundle> {
  return measureBrowserOperation("rhsia:unlock:fetch", async () => {
    const repository = new BrowserOfflineVaultRepository();
    const cached = identifier.profileId
      ? await repository.read(identifier.profileId)
      : identifier.personalVaultId
        ? await repository.readByPersonalVaultId(identifier.personalVaultId)
        : null;
    return fetchAuthorizedOfflineBundle(cached);
  });
}

async function loadLocalBundle(profileId: string): Promise<EncryptedOfflineVaultBundle> {
  const bundle = await new BrowserOfflineVaultRepository().read(profileId);
  if (!bundle) throw new Error("Local Vault Snapshot was not found.");
  return bundle;
}

function profileMaterial(bundle: EncryptedOfflineVaultBundle) {
  return {
    vaultUnlockSalt: base64ToBytes(bundle.cryptoProfile.vaultUnlockSalt),
    wrappedUserRootKey: base64ToBytes(bundle.cryptoProfile.wrappedUserRootKey),
    encryptedPersonalVaultKey: base64ToBytes(bundle.cryptoProfile.encryptedPersonalVaultKey),
    encryptionVersion: bundle.cryptoProfile.encryptionVersion
  };
}

function withMigratedProfile(bundle: EncryptedOfflineVaultBundle, profile: EncryptedPersonalVaultProfile): EncryptedOfflineVaultBundle {
  return {
    ...bundle,
    cryptoProfile: {
      vaultUnlockSalt: bytesToBase64(profile.vaultUnlockSalt),
      wrappedUserRootKey: bytesToBase64(profile.wrappedUserRootKey),
      encryptedPersonalVaultKey: bytesToBase64(profile.encryptedPersonalVaultKey),
      encryptionVersion: profile.encryptionVersion as 1
    }
  };
}

async function decryptName(key: Uint8Array, encryptedName: string, context: Parameters<typeof decryptPayloadWithContext>[2]): Promise<string> {
  const envelope = deserializeEncryptedEnvelope(base64ToBytes(encryptedName));
  const plaintext = envelope.version === 1
    ? await decryptPayload(key, envelope)
    : await decryptPayloadWithContext(key, envelope, context);
  try {
    const name = new TextDecoder("utf-8", { fatal: true }).decode(plaintext).trim();
    if (!name || name.length > 120) throw new Error("Vault name is invalid.");
    return name;
  } finally {
    plaintext.fill(0);
  }
}

async function decryptAccounts(
  encryptedAccounts: EncryptedOfflineVaultBundle["personalVault"]["accounts"],
  vault: UnlockedVault
): Promise<{ accounts: WorkspaceAuthenticatorAccount[]; unavailableAccounts: UnavailableWorkspaceAuthenticatorAccount[] }> {
  const accounts = new Array<WorkspaceAuthenticatorAccount | undefined>(encryptedAccounts.length);
  const unavailableAccounts = new Array<UnavailableWorkspaceAuthenticatorAccount | undefined>(encryptedAccounts.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(8, encryptedAccounts.length) }, async () => {
    while (nextIndex < encryptedAccounts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const encryptedAccount = encryptedAccounts[index];
      try {
        accounts[index] = {
          id: encryptedAccount.id,
          vaultId: vault.id,
          vaultName: vault.name,
          vaultType: vault.type,
          revision: encryptedAccount.revision,
          ...await decryptAccountConfiguration(vault.key, base64ToBytes(encryptedAccount.encryptedPayload), { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: vault.id, keyVersion: encryptedAccount.encryptionVersion })
        };
      } catch {
        unavailableAccounts[index] = {
          id: encryptedAccount.id,
          vaultId: vault.id,
          vaultName: vault.name,
          vaultType: vault.type,
          revision: encryptedAccount.revision
        };
      }
    }
  });
  await Promise.all(workers);
  return {
    accounts: accounts.filter((account): account is WorkspaceAuthenticatorAccount => account !== undefined),
    unavailableAccounts: unavailableAccounts.filter((account): account is UnavailableWorkspaceAuthenticatorAccount => account !== undefined)
  };
}

function assertPersonalVault(bundle: EncryptedOfflineVaultBundle, expectedVaultId: string): void {
  if (bundle.personalVault.vaultId !== expectedVaultId) throw new Error("Authorized synchronization returned a different Personal Vault.");
}

function sortWorkspaceAccounts(accounts: WorkspaceAuthenticatorAccount[]): WorkspaceAuthenticatorAccount[] {
  return [...accounts].sort((left, right) =>
    left.issuer.localeCompare(right.issuer)
      || left.accountName.localeCompare(right.accountName)
      || left.vaultName.localeCompare(right.vaultName)
  );
}

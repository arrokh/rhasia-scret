"use client";

import {
  decryptPayload,
  deserializeEncryptedEnvelope,
  recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser,
  unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey
} from "@/modules/crypto";
import {
  BrowserOfflineVaultRepository,
  fetchAuthorizedOfflineBundle,
  type EncryptedOfflineVaultBundle,
  type OfflineSyncState
} from "@/modules/sync";
import { unlockSharedVault } from "@/modules/vault-membership";
import { base64ToBytes } from "@/shared/infrastructure/browser-base64";
import { decryptAccountConfiguration, type DecryptedAuthenticatorAccount } from "./browser-account-payload";

export type UnlockedVault = {
  id: string;
  name: string;
  type: "PERSONAL" | "SHARED";
  role: "OWNER" | "VIEWER";
  key: Uint8Array;
};

export type WorkspaceAuthenticatorAccount = DecryptedAuthenticatorAccount & {
  id: string;
  vaultId: string;
  vaultName: string;
  vaultType: "PERSONAL" | "SHARED";
  revision: number;
};

export type UnlockedVaultWorkspace = {
  profileId: string;
  synchronizedAt: string;
  synchronizationToken: string;
  syncState: OfflineSyncState;
  userRootKey: Uint8Array;
  vaults: UnlockedVault[];
  accounts: WorkspaceAuthenticatorAccount[];
  unavailableSharedVaults: number;
};

export async function loadUnlockedVaultWorkspace(
  vaultUnlockSecret: string,
  personalVaultId: string
): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchAuthorizedOfflineBundle();
  assertPersonalVault(bundle, personalVaultId);
  const unlocked = await unlockPersonalVault(vaultUnlockSecret, profileMaterial(bundle));
  return decryptAndPersistOnlineBundle(bundle, unlocked.userRootKey, unlocked.personalVaultKey);
}

export async function loadUnlockedVaultWorkspaceWithRememberedBrowser(personalVaultId: string, signal?: AbortSignal): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchAuthorizedOfflineBundle();
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
  const bundle = await fetchAuthorizedOfflineBundle();
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
    return await loadWorkspace(bundle, unlocked.userRootKey, unlocked.personalVaultKey, navigator.onLine ? "STALE" : "OFFLINE");
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
    const bundle = await fetchAuthorizedOfflineBundle();
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
  personalVaultKey: Uint8Array
): Promise<UnlockedVaultWorkspace> {
  let workspace: UnlockedVaultWorkspace | undefined;
  try {
    workspace = await loadWorkspace(bundle, userRootKey, personalVaultKey, "CURRENT");
    await new BrowserOfflineVaultRepository().replace(bundle);
    return workspace;
  } catch (error) {
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
    name: await decryptName(personalVaultKey, bundle.personalVault.encryptedName),
    type: "PERSONAL",
    role: "OWNER",
    key: personalVaultKey
  };
  const decryptedPersonalAccounts = await decryptAccounts(bundle.personalVault.accounts, personalVault);
  const sharedResults = await Promise.allSettled(bundle.sharedVaults.map(async (encryptedVault) => {
    const unlocked = await unlockSharedVault(
      userRootKey,
      base64ToBytes(encryptedVault.encryptedVaultKey),
      base64ToBytes(encryptedVault.encryptedName)
    );
    const vault: UnlockedVault = {
      id: encryptedVault.vaultId,
      name: unlocked.name,
      type: "SHARED",
      role: encryptedVault.role,
      key: unlocked.vaultKey
    };
    try {
      return { vault, accounts: await decryptAccounts(encryptedVault.accounts, vault) };
    } catch (error) {
      vault.key.fill(0);
      throw error;
    }
  }));
  const sharedWorkspaces = sharedResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const vaults = [personalVault, ...sharedWorkspaces.map(({ vault }) => vault)];
  const accounts = sortWorkspaceAccounts([
    ...decryptedPersonalAccounts,
    ...sharedWorkspaces.flatMap(({ accounts: sharedAccounts }) => sharedAccounts)
  ]);
  return {
    profileId: bundle.profileId,
    synchronizedAt: bundle.synchronizedAt,
    synchronizationToken: bundle.synchronizationToken,
    syncState,
    userRootKey,
    vaults,
    accounts,
    unavailableSharedVaults: sharedResults.length - sharedWorkspaces.length
  };
}

async function loadLocalBundle(profileId: string): Promise<EncryptedOfflineVaultBundle> {
  const bundle = await new BrowserOfflineVaultRepository().read(profileId);
  if (!bundle) throw new Error("Local Vault Snapshot tidak ditemukan.");
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

async function decryptName(key: Uint8Array, encryptedName: string): Promise<string> {
  const plaintext = await decryptPayload(key, deserializeEncryptedEnvelope(base64ToBytes(encryptedName)));
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
): Promise<WorkspaceAuthenticatorAccount[]> {
  const decrypted: WorkspaceAuthenticatorAccount[] = [];
  try {
    for (const account of encryptedAccounts) {
      decrypted.push({
        id: account.id,
        vaultId: vault.id,
        vaultName: vault.name,
        vaultType: vault.type,
        revision: account.revision,
        ...await decryptAccountConfiguration(vault.key, base64ToBytes(account.encryptedPayload))
      });
    }
    return decrypted;
  } catch (error) {
    for (const account of decrypted) account.secret.fill(0);
    throw error;
  }
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

import type { CancellationPort } from "../../../shared/application/platform-ports";
import { base64ToBytes, bytesToBase64 } from "../../../shared/application/base64";
import type { EncryptedOfflineVaultBundle } from "../../sync/domain/offline-vault-bundle";
import type { OfflineSyncState } from "../../sync/domain/offline-sync-state";
import type { EffectiveSharedVaultAccountPermissions } from "../../vault-membership/domain/shared-vault-account-permissions";
import type { DecryptedAuthenticatorAccount } from "./account-payload-ports";
import type { VaultWorkspacePlatformPorts, WorkspacePersonalVaultProfile } from "./vault-workspace-ports";

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
  personalVaultId: string,
  ports: VaultWorkspacePlatformPorts
): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchMeasuredAuthorizedOfflineBundle({ personalVaultId }, ports);
  assertPersonalVault(bundle, personalVaultId);
  const unlocked = await ports.crypto.unlockPersonalVault(vaultUnlockSecret, profileMaterial(bundle));
  return decryptAndPersistOnlineBundle(bundle, unlocked.userRootKey, unlocked.personalVaultKey, ports, unlocked.migratedProfile);
}

export async function loadUnlockedVaultWorkspaceWithRememberedBrowser(personalVaultId: string, ports: VaultWorkspacePlatformPorts, signal?: CancellationPort): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchMeasuredAuthorizedOfflineBundle({ personalVaultId }, ports);
  assertPersonalVault(bundle, personalVaultId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await ports.crypto.recoverUserRootKeyWithRememberedBrowser(bundle.profileId, signal);
    personalVaultKey = await ports.crypto.unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    if (signal?.aborted) throw cancellationError("Remembered Browser unlock was cancelled.");
    return await decryptAndPersistOnlineBundle(bundle, userRootKey, personalVaultKey, ports);
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function loadUnlockedVaultWorkspaceWithPasskey(personalVaultId: string, ports: VaultWorkspacePlatformPorts): Promise<UnlockedVaultWorkspace> {
  const bundle = await fetchMeasuredAuthorizedOfflineBundle({ personalVaultId }, ports);
  assertPersonalVault(bundle, personalVaultId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await ports.crypto.recoverUserRootKeyWithPasskey();
    personalVaultKey = await ports.crypto.unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    return await decryptAndPersistOnlineBundle(bundle, userRootKey, personalVaultKey, ports);
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function loadOfflineVaultWorkspace(
  profileId: string,
  vaultUnlockSecret: string,
  ports: VaultWorkspacePlatformPorts
): Promise<UnlockedVaultWorkspace> {
  const bundle = await loadLocalBundle(profileId, ports);
  const unlocked = await ports.crypto.unlockPersonalVault(vaultUnlockSecret, profileMaterial(bundle));
  try {
    const migratedBundle = unlocked.migratedProfile ? withMigratedProfile(bundle, unlocked.migratedProfile) : bundle;
    if (unlocked.migratedProfile) await ports.data.snapshotStore.replace(migratedBundle);
    return await loadWorkspace(migratedBundle, unlocked.userRootKey, unlocked.personalVaultKey, ports.network.isOnline() ? "STALE" : "OFFLINE", ports);
  } catch (error) {
    unlocked.userRootKey.fill(0);
    unlocked.personalVaultKey.fill(0);
    throw error;
  }
}

export async function loadOfflineVaultWorkspaceWithRememberedBrowser(profileId: string, ports: VaultWorkspacePlatformPorts): Promise<UnlockedVaultWorkspace> {
  const bundle = await loadLocalBundle(profileId, ports);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await ports.crypto.recoverUserRootKeyWithRememberedBrowser(profileId);
    personalVaultKey = await ports.crypto.unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    return await loadWorkspace(bundle, userRootKey, personalVaultKey, ports.network.isOnline() ? "STALE" : "OFFLINE", ports);
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function refreshUnlockedVaultWorkspace(userRootKey: Uint8Array, expectedProfileId: string, ports: VaultWorkspacePlatformPorts): Promise<UnlockedVaultWorkspace> {
  const retainedUserRootKey = userRootKey.slice();
  try {
    const bundle = await fetchMeasuredAuthorizedOfflineBundle({ profileId: expectedProfileId }, ports);
    if (bundle.profileId !== expectedProfileId) throw new Error("The authenticated profile does not match the unlocked Local Vault Snapshot.");
    const personalVaultKey = await ports.crypto.unlockPersonalVaultWithUserRootKey(retainedUserRootKey, profileMaterial(bundle));
    return await decryptAndPersistOnlineBundle(bundle, retainedUserRootKey, personalVaultKey, ports);
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
  ports: VaultWorkspacePlatformPorts,
  migratedProfile?: WorkspacePersonalVaultProfile
): Promise<UnlockedVaultWorkspace> {
  let workspace: UnlockedVaultWorkspace | undefined;
  const persistedBundle = migratedProfile ? withMigratedProfile(bundle, migratedProfile) : bundle;
  const migration = migratedProfile
    ? ports.crypto.rewrapUserCryptoProfile({
      vaultUnlockSalt: bytesToBase64(migratedProfile.vaultUnlockSalt),
      wrappedUserRootKey: bytesToBase64(migratedProfile.wrappedUserRootKey),
      encryptedPersonalVaultKey: bytesToBase64(migratedProfile.encryptedPersonalVaultKey),
      encryptionVersion: migratedProfile.encryptionVersion
    })
    : Promise.resolve();
  const persistence = Promise.resolve()
    .then(() => ports.data.snapshotStore.replace(persistedBundle))
    .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  try {
    workspace = await loadWorkspace(bundle, userRootKey, personalVaultKey, "CURRENT", ports);
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
  syncState: OfflineSyncState,
  ports: VaultWorkspacePlatformPorts
): Promise<UnlockedVaultWorkspace> {
  const personalVault: UnlockedVault = {
    id: bundle.personalVault.vaultId,
    name: await decryptName(personalVaultKey, bundle.personalVault.encryptedName, { purpose: "vault-name", payloadType: "vault-name", keyVersion: bundle.cryptoProfile.encryptionVersion }, ports),
    type: "PERSONAL",
    role: "OWNER",
    effectiveAccountPermissions: {
      permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
      sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" }
    },
    key: personalVaultKey
  };
  const personalAccountResult = await decryptAccounts(bundle.personalVault.accounts, personalVault, ports);
  const sharedResults = await Promise.allSettled(bundle.sharedVaults.map(async (encryptedVault) => {
    const unlocked = await ports.crypto.unlockSharedVault(
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
      return { vault, accountResult: await decryptAccounts(encryptedVault.accounts, vault, ports) };
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

async function fetchMeasuredAuthorizedOfflineBundle(identifier: { personalVaultId?: string; profileId?: string }, ports: VaultWorkspacePlatformPorts): Promise<EncryptedOfflineVaultBundle> {
  const repository = ports.data.snapshotStore;
  const snapshot = identifier.profileId
    ? await repository.read(identifier.profileId)
    : identifier.personalVaultId
      ? await repository.readByPersonalVaultId(identifier.personalVaultId)
      : null;
  return ports.data.fetchAuthorizedOfflineBundle(snapshot ?? null);
}

async function loadLocalBundle(profileId: string, ports: VaultWorkspacePlatformPorts): Promise<EncryptedOfflineVaultBundle> {
  const bundle = await ports.data.snapshotStore.read(profileId);
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

function withMigratedProfile(bundle: EncryptedOfflineVaultBundle, profile: WorkspacePersonalVaultProfile): EncryptedOfflineVaultBundle {
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

async function decryptName(key: Uint8Array, encryptedName: string, context: Parameters<VaultWorkspacePlatformPorts["crypto"]["decryptPayloadWithContext"]>[2], ports: VaultWorkspacePlatformPorts): Promise<string> {
  const envelope = ports.crypto.deserializeEncryptedEnvelope(base64ToBytes(encryptedName));
  const plaintext = envelope.version === 1
    ? await ports.crypto.decryptPayload(key, envelope)
    : await ports.crypto.decryptPayloadWithContext(key, envelope, context);
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
  vault: UnlockedVault,
  ports: VaultWorkspacePlatformPorts
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
          ...await ports.crypto.decryptAccountConfiguration(vault.key, base64ToBytes(encryptedAccount.encryptedPayload), { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: vault.id, keyVersion: encryptedAccount.encryptionVersion })
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

function cancellationError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

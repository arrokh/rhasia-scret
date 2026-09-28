import type { CancellationPort } from "../../../shared/application/platform-ports";
import { AuthorizedWorkspaceTransportError } from "../../sync/application/authorized-workspace-transport";
import { base64ToBytes, bytesToBase64 } from "../../../shared/application/base64";
import {
  composeOnlineWorkspaceBundle,
  type AuthorizedWorkspaceResponse,
  type EncryptedOnlineWorkspaceBundle,
  type EncryptedPersonalOfflineSnapshot,
  type EncryptedUserEncryptionIdentityProfile,
} from "../../sync/domain/offline-vault-bundle";
import type { OfflineSyncState } from "../../sync/domain/offline-sync-state";
import type { EffectiveSharedVaultAccountPermissions } from "../../vault-membership/domain/shared-vault-account-permissions";
import type { DecryptedAuthenticatorAccount } from "./account-payload-ports";
import { PersonalVaultUnlockError } from "../../crypto/application/unlock-personal-vault";
import {
  migrateLegacyEncryptedPayloadWithCrypto,
  type EncryptedPayloadMigrationStore,
} from "../../crypto/application/encrypted-payload-migration";
import { UserEncryptionPrivateKeyRecoveryError } from "../../crypto/application/user-encryption-identity";
import type { VaultWorkspacePlatformPorts, WorkspacePersonalVaultProfile } from "./vault-workspace-ports";

export type UnlockedVault = {
  id: string;
  name: string;
  type: "PERSONAL" | "SHARED";
  role: "OWNER" | "VIEWER";
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  keyVersion: number;
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

export type VaultWorkspaceUnlockFailureStage =
  | "workspace-response"
  | "workspace-bundle"
  | "personal-vault-selection"
  | "crypto-unlock"
  | "personal-vault-name-decryption"
  | "user-encryption-private-key-recovery"
  | "vault-content-decryption"
  | "profile-rewrap"
  | "workspace-processing";

export class VaultWorkspaceUnlockError extends Error {
  public constructor(
    public readonly stage: VaultWorkspaceUnlockFailureStage,
    cause?: unknown,
  ) {
    super("Vault workspace unlock failed.", { cause });
    this.name = "VaultWorkspaceUnlockError";
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
  userEncryptionPublicKey?: EncryptedUserEncryptionIdentityProfile["publicKey"];
};

export async function loadUnlockedVaultWorkspace(
  vaultUnlockSecret: string,
  personalVaultId: string,
  ports: VaultWorkspacePlatformPorts,
): Promise<UnlockedVaultWorkspace> {
  let response: AuthorizedWorkspaceResponse;
  try {
    response = await fetchMeasuredAuthorizedWorkspaceBundle(ports);
  } catch (error) {
    if (error instanceof AuthorizedWorkspaceTransportError) throw error;
    throw new VaultWorkspaceUnlockError("workspace-response", error);
  }

  let bundle: EncryptedOnlineWorkspaceBundle;
  try {
    bundle = composeOnlineWorkspaceBundle(response);
  } catch (error) {
    throw new VaultWorkspaceUnlockError("workspace-bundle", error);
  }
  try {
    assertPersonalVault(bundle, personalVaultId);
  } catch (error) {
    throw new VaultWorkspaceUnlockError("personal-vault-selection", error);
  }

  let unlocked: Awaited<ReturnType<VaultWorkspacePlatformPorts["crypto"]["unlockPersonalVault"]>>;
  try {
    unlocked = await ports.crypto.unlockPersonalVault(vaultUnlockSecret, profileMaterial(response.personalSnapshot));
  } catch (error) {
    if (error instanceof PersonalVaultUnlockError) throw error;
    throw new VaultWorkspaceUnlockError("crypto-unlock", error);
  }

  try {
    return await decryptAndPersistOnlineBundle(
      response,
      unlocked.userRootKey,
      unlocked.personalVaultKey,
      ports,
      unlocked.migratedProfile,
    );
  } catch (error) {
    if (
      error instanceof LocalStorageSyncError ||
      error instanceof AuthorizedWorkspaceTransportError ||
      error instanceof UserEncryptionPrivateKeyRecoveryError ||
      error instanceof VaultWorkspaceUnlockError
    )
      throw error;
    throw new VaultWorkspaceUnlockError("workspace-processing", error);
  }
}

export async function loadUnlockedVaultWorkspaceWithRememberedBrowser(
  personalVaultId: string,
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): Promise<UnlockedVaultWorkspace> {
  const response = await fetchMeasuredAuthorizedWorkspaceBundle(ports);
  const bundle = composeOnlineWorkspaceBundle(response);
  assertPersonalVault(bundle, personalVaultId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await ports.crypto.recoverUserRootKeyWithRememberedBrowser(bundle.profileId, signal);
    const unlocked = await ports.crypto.unlockPersonalVaultWithUserRootKey(
      userRootKey,
      profileMaterial(response.personalSnapshot),
    );
    personalVaultKey = unlocked.personalVaultKey;
    if (signal?.aborted) throw cancellationError("Remembered Browser unlock was cancelled.");
    return await decryptAndPersistOnlineBundle(
      response,
      userRootKey,
      personalVaultKey,
      ports,
      unlocked.migratedProfile,
    );
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function loadUnlockedVaultWorkspaceWithPasskey(
  personalVaultId: string,
  ports: VaultWorkspacePlatformPorts,
): Promise<UnlockedVaultWorkspace> {
  const response = await fetchMeasuredAuthorizedWorkspaceBundle(ports);
  const bundle = composeOnlineWorkspaceBundle(response);
  assertPersonalVault(bundle, personalVaultId);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await ports.crypto.recoverUserRootKeyWithPasskey();
    const unlocked = await ports.crypto.unlockPersonalVaultWithUserRootKey(
      userRootKey,
      profileMaterial(response.personalSnapshot),
    );
    personalVaultKey = unlocked.personalVaultKey;
    return await decryptAndPersistOnlineBundle(
      response,
      userRootKey,
      personalVaultKey,
      ports,
      unlocked.migratedProfile,
    );
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function loadOfflineVaultWorkspace(
  profileId: string,
  vaultUnlockSecret: string,
  ports: VaultWorkspacePlatformPorts,
): Promise<UnlockedVaultWorkspace> {
  const bundle = await loadLocalBundle(profileId, ports);
  const unlocked = await ports.crypto.unlockPersonalVault(vaultUnlockSecret, profileMaterial(bundle));
  try {
    const migratedBundle = unlocked.migratedProfile ? withMigratedProfile(bundle, unlocked.migratedProfile) : bundle;
    if (unlocked.migratedProfile) {
      try {
        await ports.data.snapshotStore.replace(migratedBundle);
      } catch (error) {
        throw new LocalStorageSyncError(error);
      }
    }
    return await loadWorkspace(
      migratedBundle,
      unlocked.userRootKey,
      unlocked.personalVaultKey,
      ports.network.isOnline() ? "STALE" : "OFFLINE",
      ports,
    );
  } catch (error) {
    unlocked.userRootKey.fill(0);
    unlocked.personalVaultKey.fill(0);
    throw error;
  }
}

export async function loadOfflineVaultWorkspaceWithRememberedBrowser(
  profileId: string,
  ports: VaultWorkspacePlatformPorts,
): Promise<UnlockedVaultWorkspace> {
  const bundle = await loadLocalBundle(profileId, ports);
  let userRootKey: Uint8Array | undefined;
  let personalVaultKey: Uint8Array | undefined;
  try {
    userRootKey = await ports.crypto.recoverUserRootKeyWithRememberedBrowser(profileId);
    const unlocked = await ports.crypto.unlockPersonalVaultWithUserRootKey(userRootKey, profileMaterial(bundle));
    personalVaultKey = unlocked.personalVaultKey;
    const migratedBundle = unlocked.migratedProfile ? withMigratedProfile(bundle, unlocked.migratedProfile) : bundle;
    if (unlocked.migratedProfile) {
      try {
        await ports.data.snapshotStore.replace(migratedBundle);
      } catch (error) {
        throw new LocalStorageSyncError(error);
      }
    }
    return await loadWorkspace(
      migratedBundle,
      userRootKey,
      personalVaultKey,
      ports.network.isOnline() ? "STALE" : "OFFLINE",
      ports,
    );
  } catch (error) {
    userRootKey?.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  }
}

export async function refreshUnlockedVaultWorkspace(
  userRootKey: Uint8Array,
  expectedProfileId: string,
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): Promise<UnlockedVaultWorkspace> {
  const retainedUserRootKey = userRootKey.slice();
  let personalVaultKey: Uint8Array | undefined;
  const disposeCancellation = signal?.subscribe(() => {
    retainedUserRootKey.fill(0);
    personalVaultKey?.fill(0);
  });
  try {
    const response = await fetchMeasuredAuthorizedWorkspaceBundle(ports, signal);
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    const bundle = composeOnlineWorkspaceBundle(response);
    if (bundle.profileId !== expectedProfileId)
      throw new Error("The authenticated profile does not match the unlocked Local Vault Snapshot.");
    const unlocked = await ports.crypto.unlockPersonalVaultWithUserRootKey(
      retainedUserRootKey,
      profileMaterial(response.personalSnapshot),
    );
    personalVaultKey = unlocked.personalVaultKey;
    if (signal?.aborted) {
      personalVaultKey.fill(0);
      throw cancellationError("Workspace refresh was cancelled.");
    }
    return await decryptAndPersistOnlineBundle(
      response,
      retainedUserRootKey,
      personalVaultKey,
      ports,
      unlocked.migratedProfile,
      signal,
    );
  } catch (error) {
    retainedUserRootKey.fill(0);
    personalVaultKey?.fill(0);
    throw error;
  } finally {
    disposeCancellation?.();
  }
}

export function clearUnlockedVaultWorkspace(workspace: UnlockedVaultWorkspace | null): void {
  if (!workspace) return;
  workspace.userRootKey.fill(0);
  for (const vault of workspace.vaults) vault.key.fill(0);
  for (const account of workspace.accounts) account.secret.fill(0);
}

export function evictSharedVaultWorkspace(workspace: UnlockedVaultWorkspace): UnlockedVaultWorkspace {
  const personalVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL");
  const personalVaultIds = new Set(personalVaults.map((vault) => vault.id));
  for (const vault of workspace.vaults) {
    if (vault.type === "SHARED") vault.key.fill(0);
  }
  for (const account of workspace.accounts) {
    if (!personalVaultIds.has(account.vaultId)) account.secret.fill(0);
  }
  return {
    ...workspace,
    vaults: personalVaults,
    accounts: workspace.accounts.filter((account) => personalVaultIds.has(account.vaultId)),
    unavailableAccounts: workspace.unavailableAccounts.filter((account) => personalVaultIds.has(account.vaultId)),
    unavailableSharedVaults: 0,
  };
}

async function decryptAndPersistOnlineBundle(
  response: AuthorizedWorkspaceResponse,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array,
  ports: VaultWorkspacePlatformPorts,
  migratedProfile?: WorkspacePersonalVaultProfile,
  signal?: CancellationPort,
): Promise<UnlockedVaultWorkspace> {
  let workspace: UnlockedVaultWorkspace | undefined;
  let activeResponse: AuthorizedWorkspaceResponse;
  try {
    activeResponse = await ensureUserEncryptionIdentity(response, userRootKey, ports, signal);
  } catch (error) {
    userRootKey.fill(0);
    personalVaultKey.fill(0);
    throw error;
  }
  const bundle = composeOnlineWorkspaceBundle(activeResponse);
  const persistedBundle = migratedProfile
    ? withMigratedProfile(activeResponse.personalSnapshot, migratedProfile)
    : activeResponse.personalSnapshot;
  let migration: Promise<void>;
  try {
    migration = migratedProfile
      ? persistMigratedUserCryptoProfile(activeResponse.personalSnapshot.cryptoProfile, migratedProfile, ports, signal)
      : Promise.resolve();
  } catch (error) {
    userRootKey.fill(0);
    personalVaultKey.fill(0);
    throw new VaultWorkspaceUnlockError("profile-rewrap", error);
  }
  const persistence = signal
    ? null
    : Promise.resolve()
        .then(() => ports.data.snapshotStore.replace(persistedBundle))
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
  const disposeWorkspaceCancellation = signal?.subscribe(() => {
    if (workspace) clearUnlockedVaultWorkspace(workspace);
  });
  try {
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    try {
      workspace = await loadWorkspace(
        bundle,
        userRootKey,
        personalVaultKey,
        "CURRENT",
        ports,
        signal,
        activeResponse.userEncryptionIdentity,
      );
    } catch (error) {
      if (
        isCancellationError(error) ||
        error instanceof UserEncryptionPrivateKeyRecoveryError ||
        error instanceof VaultWorkspaceUnlockError
      )
        throw error;
      throw new VaultWorkspaceUnlockError("vault-content-decryption", error);
    }
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    try {
      await migration;
    } catch (error) {
      throw new VaultWorkspaceUnlockError("profile-rewrap", error);
    }
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    if (persistence) {
      const result = await persistence;
      if (!result.ok) throw new LocalStorageSyncError(result.error);
    } else {
      try {
        await ports.data.snapshotStore.replace(persistedBundle);
      } catch (error) {
        throw new LocalStorageSyncError(error);
      }
    }
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    return workspace;
  } catch (error) {
    await Promise.allSettled([migration, ...(persistence ? [persistence] : [])]);
    if (workspace) clearUnlockedVaultWorkspace(workspace);
    else {
      userRootKey.fill(0);
      personalVaultKey.fill(0);
    }
    throw error;
  } finally {
    disposeWorkspaceCancellation?.();
  }
}

async function ensureUserEncryptionIdentity(
  response: AuthorizedWorkspaceResponse,
  userRootKey: Uint8Array,
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): Promise<AuthorizedWorkspaceResponse> {
  if (response.userEncryptionIdentity) return response;

  let identity: Awaited<ReturnType<VaultWorkspacePlatformPorts["crypto"]["createUserEncryptionIdentity"]>> | undefined;
  let encryptedPrivateKey: Uint8Array | undefined;
  try {
    identity = await ports.crypto.createUserEncryptionIdentity(userRootKey);
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    encryptedPrivateKey = ports.crypto.serializeEncryptedEnvelope(identity.encryptedPrivateKey);
    const registered = await ports.data.registerUserEncryptionIdentity(
      { publicKey: identity.publicKey, encryptedPrivateKey, encryptionVersion: 1 },
      signal,
    );
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    if (registered) {
      return {
        ...response,
        userEncryptionIdentity: {
          publicKey: identity.publicKey,
          encryptedPrivateKey: bytesToBase64(encryptedPrivateKey),
          encryptionVersion: 1,
        },
      };
    }
    const refreshed = await ports.data.fetchAuthorizedWorkspaceBundle(signal);
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    if (!sameWorkspaceProfile(response, refreshed) || !refreshed.userEncryptionIdentity) return response;
    return refreshed;
  } catch (error) {
    if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
    return response;
  } finally {
    encryptedPrivateKey?.fill(0);
    identity?.encryptedPrivateKey.nonce.fill(0);
    identity?.encryptedPrivateKey.ciphertext.fill(0);
  }
}

function sameWorkspaceProfile(left: AuthorizedWorkspaceResponse, right: AuthorizedWorkspaceResponse): boolean {
  return (
    left.personalSnapshot.profileId === right.personalSnapshot.profileId &&
    left.personalSnapshot.personalVault.vaultId === right.personalSnapshot.personalVault.vaultId &&
    left.personalSnapshot.cryptoProfile.vaultUnlockSalt === right.personalSnapshot.cryptoProfile.vaultUnlockSalt &&
    left.personalSnapshot.cryptoProfile.wrappedUserRootKey ===
      right.personalSnapshot.cryptoProfile.wrappedUserRootKey &&
    left.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey ===
      right.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey &&
    left.personalSnapshot.cryptoProfile.encryptionVersion === right.personalSnapshot.cryptoProfile.encryptionVersion
  );
}

async function loadWorkspace(
  bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array,
  syncState: OfflineSyncState,
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
  encryptedUserEncryptionIdentity?: EncryptedUserEncryptionIdentityProfile,
): Promise<UnlockedVaultWorkspace> {
  let personalVaultName: string;
  try {
    personalVaultName = await decryptName(
      personalVaultKey,
      bundle.personalVault.encryptedName,
      { purpose: "vault-name", payloadType: "vault-name", keyVersion: bundle.cryptoProfile.encryptionVersion },
      ports,
      bundle,
      signal,
    );
  } catch (error) {
    if (isCancellationError(error)) throw error;
    throw new VaultWorkspaceUnlockError("personal-vault-name-decryption", error);
  }
  const personalVault: UnlockedVault = {
    id: bundle.personalVault.vaultId,
    name: personalVaultName,
    type: "PERSONAL",
    role: "OWNER",
    effectiveAccountPermissions: {
      permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
      sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
    },
    keyVersion: 1,
    key: personalVaultKey,
  };
  const personalAccountResult = await decryptAccounts(
    bundle.personalVault.accounts,
    personalVault,
    ports,
    bundle,
    signal,
  );
  const sharedVaults = "sharedVaults" in bundle ? bundle.sharedVaults : [];
  const sharedVaultKeys = new Set<Uint8Array>();
  let userEncryptionPrivateKey:
    Awaited<ReturnType<VaultWorkspacePlatformPorts["crypto"]["recoverOrMigratePrivateKey"]>> | undefined;
  if (sharedVaults.length && encryptedUserEncryptionIdentity) {
    const encryptedPrivateKey = base64ToBytes(encryptedUserEncryptionIdentity.encryptedPrivateKey);
    try {
      userEncryptionPrivateKey = await ports.crypto.recoverOrMigratePrivateKey(
        userRootKey,
        encryptedPrivateKey,
        encryptedUserEncryptionIdentity.publicKey,
        encryptedUserEncryptionIdentity.encryptionVersion,
        signal,
      );
    } catch (error) {
      if (isCancellationError(error) || error instanceof UserEncryptionPrivateKeyRecoveryError) throw error;
      throw new VaultWorkspaceUnlockError("user-encryption-private-key-recovery", error);
    } finally {
      encryptedPrivateKey.fill(0);
    }
  }
  let disposeSharedKeyCancellation: (() => void) | undefined;
  let sharedResults: PromiseSettledResult<{
    vault: UnlockedVault;
    accountResult: Awaited<ReturnType<typeof decryptAccounts>>;
  }>[];
  try {
    disposeSharedKeyCancellation = signal?.subscribe(() => {
      for (const key of sharedVaultKeys) key.fill(0);
    });
    sharedResults = await Promise.allSettled(
      sharedVaults.map(async (encryptedVault) => {
        const encryptedVaultKey = base64ToBytes(encryptedVault.encryptedVaultKey);
        let migratedVaultKey: Uint8Array | undefined;
        let vaultKey: Uint8Array | undefined;
        let vaultName: string;
        try {
          if (userEncryptionPrivateKey && encryptedUserEncryptionIdentity) {
            const migration = await ports.crypto.migrateSharedVaultKeyWrap(
              userRootKey,
              encryptedVaultKey,
              userEncryptionPrivateKey,
              encryptedUserEncryptionIdentity.publicKey,
              {
                vaultId: encryptedVault.vaultId,
                recipientId: bundle.profileId,
                keyVersion: encryptedVault.keyVersion,
              },
              {
                commitEncryptedPayloadMigration: (request) =>
                  ports.data.migrateSharedVaultKeyWrap(
                    encryptedVault.vaultId,
                    encryptedVault.keyVersion,
                    request,
                    signal,
                  ),
              },
            );
            if (migration.status === "migrated") {
              migratedVaultKey = migration.encryptedVaultKey;
              encryptedVault.encryptedVaultKey = bytesToBase64(migratedVaultKey);
            }
          }
          vaultKey = await ports.crypto.unwrapSharedVaultKey(userRootKey, migratedVaultKey ?? encryptedVaultKey, {
            vaultId: encryptedVault.vaultId,
            recipientId: bundle.profileId,
            keyVersion: encryptedVault.keyVersion,
            ...(userEncryptionPrivateKey ? { userEncryptionPrivateKey } : {}),
          });
          vaultName = await decryptName(
            vaultKey,
            encryptedVault.encryptedName,
            {
              purpose: "vault-name",
              payloadType: "vault-name",
              vaultId: encryptedVault.vaultId,
              keyVersion: encryptedVault.encryptionVersion,
            },
            ports,
            bundle,
            signal,
            sharedVaultNameMigrationStore(encryptedVault, ports, signal),
          );
          if (signal?.aborted) throw cancellationError("Workspace refresh was cancelled.");
        } catch (error) {
          vaultKey?.fill(0);
          throw error;
        } finally {
          encryptedVaultKey.fill(0);
          migratedVaultKey?.fill(0);
        }
        if (!vaultKey) throw new Error("Shared Vault Encryption Key is unavailable.");
        sharedVaultKeys.add(vaultKey);
        const vault: UnlockedVault = {
          id: encryptedVault.vaultId,
          name: vaultName,
          type: "SHARED",
          role: encryptedVault.role,
          effectiveAccountPermissions: encryptedVault.effectiveAccountPermissions,
          keyVersion: encryptedVault.keyVersion,
          key: vaultKey,
        };
        try {
          return { vault, accountResult: await decryptAccounts(encryptedVault.accounts, vault, ports, bundle, signal) };
        } catch (error) {
          vault.key.fill(0);
          throw error;
        }
      }),
    );
    if (signal?.aborted) {
      for (const account of personalAccountResult.accounts) account.secret.fill(0);
      for (const result of sharedResults) {
        if (result.status !== "fulfilled") continue;
        result.value.vault.key.fill(0);
        for (const account of result.value.accountResult.accounts) account.secret.fill(0);
      }
      throw cancellationError("Workspace refresh was cancelled.");
    }
  } finally {
    clearUserEncryptionPrivateKey(userEncryptionPrivateKey);
    userEncryptionPrivateKey = undefined;
    disposeSharedKeyCancellation?.();
  }
  const sharedWorkspaces = sharedResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const vaults = [personalVault, ...sharedWorkspaces.map(({ vault }) => vault)];
  const accounts = sortWorkspaceAccounts([
    ...personalAccountResult.accounts,
    ...sharedWorkspaces.flatMap(({ accountResult }) => accountResult.accounts),
  ]);
  const unavailableAccounts = [
    ...personalAccountResult.unavailableAccounts,
    ...sharedWorkspaces.flatMap(({ accountResult }) => accountResult.unavailableAccounts),
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
    unavailableSharedVaults: sharedResults.length - sharedWorkspaces.length,
    ...(encryptedUserEncryptionIdentity ? { userEncryptionPublicKey: encryptedUserEncryptionIdentity.publicKey } : {}),
  };
}

async function fetchMeasuredAuthorizedWorkspaceBundle(
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): Promise<AuthorizedWorkspaceResponse> {
  return ports.data.fetchAuthorizedWorkspaceBundle(signal);
}

async function loadLocalBundle(
  profileId: string,
  ports: VaultWorkspacePlatformPorts,
): Promise<EncryptedPersonalOfflineSnapshot> {
  let bundle: EncryptedPersonalOfflineSnapshot | null;
  try {
    bundle = await ports.data.snapshotStore.read(profileId);
  } catch (error) {
    throw new LocalStorageSyncError(error);
  }
  if (!bundle) throw new Error("Local Vault Snapshot was not found.");
  return bundle;
}

function profileMaterial(bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot) {
  return {
    vaultUnlockSalt: base64ToBytes(bundle.cryptoProfile.vaultUnlockSalt),
    wrappedUserRootKey: base64ToBytes(bundle.cryptoProfile.wrappedUserRootKey),
    encryptedPersonalVaultKey: base64ToBytes(bundle.cryptoProfile.encryptedPersonalVaultKey),
    encryptionVersion: bundle.cryptoProfile.encryptionVersion,
  };
}

async function persistMigratedUserCryptoProfile(
  source: EncryptedPersonalOfflineSnapshot["cryptoProfile"],
  replacement: WorkspacePersonalVaultProfile,
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): Promise<void> {
  const sourceWrappedUserRootKey = base64ToBytes(source.wrappedUserRootKey);
  const sourcePersonalVaultKey = base64ToBytes(source.encryptedPersonalVaultKey);
  const migration = {
    ...(bytesEqual(sourceWrappedUserRootKey, replacement.wrappedUserRootKey)
      ? {}
      : {
          wrappedUserRootKey: {
            expectedCiphertext: sourceWrappedUserRootKey,
            replacementCiphertext: replacement.wrappedUserRootKey.slice(),
          },
        }),
    ...(bytesEqual(sourcePersonalVaultKey, replacement.encryptedPersonalVaultKey)
      ? {}
      : {
          encryptedPersonalVaultKey: {
            expectedCiphertext: sourcePersonalVaultKey,
            replacementCiphertext: replacement.encryptedPersonalVaultKey.slice(),
          },
        }),
  };
  try {
    if (!migration.wrappedUserRootKey && !migration.encryptedPersonalVaultKey) return;
    const result = await ports.data.migrateUserCryptoProfile(migration, signal);
    if (result === "conflict") throw new Error("The crypto profile changed before its migration was committed.");
  } finally {
    sourceWrappedUserRootKey.fill(0);
    sourcePersonalVaultKey.fill(0);
    migration.wrappedUserRootKey?.replacementCiphertext.fill(0);
    migration.encryptedPersonalVaultKey?.replacementCiphertext.fill(0);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function withMigratedProfile(
  bundle: EncryptedPersonalOfflineSnapshot,
  profile: WorkspacePersonalVaultProfile,
): EncryptedPersonalOfflineSnapshot {
  return {
    ...bundle,
    cryptoProfile: {
      vaultUnlockSalt: bytesToBase64(profile.vaultUnlockSalt),
      wrappedUserRootKey: bytesToBase64(profile.wrappedUserRootKey),
      encryptedPersonalVaultKey: bytesToBase64(profile.encryptedPersonalVaultKey),
      encryptionVersion: profile.encryptionVersion as 1,
    },
  };
}

async function decryptName(
  key: Uint8Array,
  encryptedName: string,
  context: Parameters<VaultWorkspacePlatformPorts["crypto"]["decryptPayloadWithContext"]>[2],
  ports: VaultWorkspacePlatformPorts,
  bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot,
  signal?: CancellationPort,
  migrationStore: EncryptedPayloadMigrationStore = personalVaultNameMigrationStore(bundle, ports, signal),
): Promise<string> {
  const ciphertext = base64ToBytes(encryptedName);
  let envelope: ReturnType<VaultWorkspacePlatformPorts["crypto"]["deserializeEncryptedEnvelope"]> | undefined;
  try {
    envelope = ports.crypto.deserializeEncryptedEnvelope(ciphertext);
    if (envelope.version === 1) {
      return await migrateLegacyEncryptedPayloadWithCrypto(
        key,
        ciphertext,
        {
          context,
          validatePlaintext: validateVaultName,
          clearValidatedPayload: () => undefined,
        },
        ports.crypto,
        ports.migrationDigest,
        migrationStore,
      );
    }
    const plaintext = await ports.crypto.decryptPayloadWithContext(key, envelope, context);
    try {
      return validateVaultName(plaintext);
    } finally {
      plaintext.fill(0);
    }
  } finally {
    ciphertext.fill(0);
    envelope?.nonce.fill(0);
    envelope?.ciphertext.fill(0);
  }
}

function validateVaultName(plaintext: Uint8Array): string {
  const name = new TextDecoder("utf-8", { fatal: true }).decode(plaintext).trim();
  if (!name || name.length > 120) throw new Error("Vault name is invalid.");
  return name;
}

function sharedVaultNameMigrationStore(
  vault: EncryptedOnlineWorkspaceBundle["sharedVaults"][number],
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): EncryptedPayloadMigrationStore {
  return {
    commitEncryptedPayloadMigration: async (request) => {
      const result = await ports.data.migrateSharedVaultName(vault.vaultId, vault.keyVersion, request, signal);
      if (result !== "conflict") vault.encryptedName = bytesToBase64(request.replacementCiphertext);
      return result;
    },
  };
}

function personalVaultNameMigrationStore(
  bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot,
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): EncryptedPayloadMigrationStore {
  return {
    commitEncryptedPayloadMigration: async (request) => {
      let result: "committed" | "already-committed" | "conflict";
      const replacementCiphertext = bytesToBase64(request.replacementCiphertext);
      if ("sharedVaults" in bundle) {
        result = await ports.data.migratePersonalVaultName(
          bundle.personalVault.vaultId,
          bundle.personalVault.encryptionVersion,
          request,
          signal,
        );
      } else {
        const replacementSnapshot = {
          ...bundle,
          personalVault: { ...bundle.personalVault, encryptedName: replacementCiphertext },
        };
        await ports.data.snapshotStore.replace(replacementSnapshot);
        result = "committed";
      }
      if (result !== "conflict") bundle.personalVault.encryptedName = replacementCiphertext;
      return result;
    },
  };
}

async function decryptAccounts(
  encryptedAccounts: (EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot)["personalVault"]["accounts"],
  vault: UnlockedVault,
  ports: VaultWorkspacePlatformPorts,
  bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot,
  signal?: CancellationPort,
): Promise<{
  accounts: WorkspaceAuthenticatorAccount[];
  unavailableAccounts: UnavailableWorkspaceAuthenticatorAccount[];
}> {
  const accounts = new Array<WorkspaceAuthenticatorAccount | undefined>(encryptedAccounts.length);
  const unavailableAccounts = new Array<UnavailableWorkspaceAuthenticatorAccount | undefined>(encryptedAccounts.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(8, encryptedAccounts.length) }, async () => {
    while (nextIndex < encryptedAccounts.length) {
      const index = nextIndex;
      nextIndex += 1;
      if (signal?.aborted) return;
      const encryptedAccount = encryptedAccounts[index];
      const ciphertext = base64ToBytes(encryptedAccount.encryptedPayload);
      try {
        const context = {
          purpose: "authenticator-account" as const,
          payloadType: "totp-configuration" as const,
          vaultId: vault.id,
          keyVersion: encryptedAccount.encryptionVersion,
        };
        const decrypted =
          ciphertext[0] === 1
            ? await migrateLegacyEncryptedPayloadWithCrypto(
                vault.key,
                ciphertext,
                {
                  context,
                  validatePlaintext: (plaintext) => ports.crypto.parseDecryptedAccountPayload(plaintext),
                  clearValidatedPayload: (account) => account.secret.fill(0),
                },
                ports.crypto,
                ports.migrationDigest,
                authenticatorAccountMigrationStore(bundle, vault, encryptedAccount, ports, signal),
              )
            : await ports.crypto.decryptAccountConfiguration(vault.key, ciphertext, context);
        if (signal?.aborted) {
          decrypted.secret.fill(0);
          return;
        }
        accounts[index] = {
          id: encryptedAccount.id,
          vaultId: vault.id,
          vaultName: vault.name,
          vaultType: vault.type,
          revision: encryptedAccount.revision,
          ...decrypted,
        };
      } catch {
        if (signal?.aborted) return;
        unavailableAccounts[index] = {
          id: encryptedAccount.id,
          vaultId: vault.id,
          vaultName: vault.name,
          vaultType: vault.type,
          revision: encryptedAccount.revision,
        };
      } finally {
        ciphertext.fill(0);
      }
    }
  });
  const workerResults = await Promise.allSettled(workers);
  if (signal?.aborted) {
    for (const account of accounts) account?.secret.fill(0);
    throw cancellationError("Workspace refresh was cancelled.");
  }
  const failedWorker = workerResults.find((result) => result.status === "rejected");
  if (failedWorker?.status === "rejected") throw failedWorker.reason;
  return {
    accounts: accounts.filter((account): account is WorkspaceAuthenticatorAccount => account !== undefined),
    unavailableAccounts: unavailableAccounts.filter(
      (account): account is UnavailableWorkspaceAuthenticatorAccount => account !== undefined,
    ),
  };
}

function authenticatorAccountMigrationStore(
  bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot,
  vault: UnlockedVault,
  encryptedAccount: (
    EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot
  )["personalVault"]["accounts"][number],
  ports: VaultWorkspacePlatformPorts,
  signal?: CancellationPort,
): EncryptedPayloadMigrationStore {
  return {
    commitEncryptedPayloadMigration: async (request) => {
      const replacementCiphertext = bytesToBase64(request.replacementCiphertext);
      let result: "committed" | "already-committed" | "conflict";
      if (vault.type === "PERSONAL" && "sharedVaults" in bundle) {
        result = await ports.data.migratePersonalAuthenticatorAccount(
          vault.id,
          encryptedAccount.id,
          encryptedAccount.revision,
          vault.keyVersion,
          request,
          signal,
        );
      } else if (vault.type === "PERSONAL" && !("sharedVaults" in bundle)) {
        const replacementSnapshot = {
          ...bundle,
          personalVault: {
            ...bundle.personalVault,
            accounts: bundle.personalVault.accounts.map((account) =>
              account.id === encryptedAccount.id ? { ...account, encryptedPayload: replacementCiphertext } : account,
            ),
          },
        };
        await ports.data.snapshotStore.replace(replacementSnapshot);
        result = "committed";
      } else if (vault.type === "SHARED" && "sharedVaults" in bundle) {
        result = await ports.data.migrateSharedAuthenticatorAccount(
          vault.id,
          encryptedAccount.id,
          encryptedAccount.revision,
          vault.keyVersion,
          request,
          signal,
        );
      } else {
        return "conflict";
      }
      if (result !== "conflict") encryptedAccount.encryptedPayload = replacementCiphertext;
      return result;
    },
  };
}

function assertPersonalVault(
  bundle: EncryptedOnlineWorkspaceBundle | EncryptedPersonalOfflineSnapshot,
  expectedVaultId: string,
): void {
  if (bundle.personalVault.vaultId !== expectedVaultId)
    throw new Error("Authorized synchronization returned a different Personal Vault.");
}

function sortWorkspaceAccounts(accounts: WorkspaceAuthenticatorAccount[]): WorkspaceAuthenticatorAccount[] {
  return [...accounts].sort(
    (left, right) =>
      left.issuer.localeCompare(right.issuer) ||
      left.accountName.localeCompare(right.accountName) ||
      left.vaultName.localeCompare(right.vaultName),
  );
}

function clearUserEncryptionPrivateKey(
  privateKey: Awaited<ReturnType<VaultWorkspacePlatformPorts["crypto"]["recoverOrMigratePrivateKey"]>> | undefined,
): void {
  if (!privateKey) return;
  Reflect.set(privateKey, "x", "");
  Reflect.set(privateKey, "y", "");
  Reflect.set(privateKey, "d", "");
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function cancellationError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

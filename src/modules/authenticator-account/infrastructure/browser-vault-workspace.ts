"use client";

import {
  createUserEncryptionIdentity,
  serializeEncryptedEnvelope,
  unlockPersonalVault
} from "@/modules/crypto";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";
import { unlockSharedVault } from "@/modules/vault-membership";
import { decryptAccountConfiguration, type DecryptedAuthenticatorAccount } from "./browser-account-payload";

type ProfileResponse = {
  vaultUnlockSalt: string;
  wrappedUserRootKey: string;
  encryptedPersonalVaultKey: string;
  encryptionVersion: number;
  userEncryptionPublicKey?: JsonWebKey;
  encryptedUserPrivateKey?: string;
};

type EncryptedAccountResponse = {
  id: string;
  encryptedPayload: string;
  encryptionVersion: number;
  revision: number;
};

type SharedVaultResponse = {
  vaultId: string;
  role: "OWNER" | "VIEWER";
  encryptedName: string;
  encryptionVersion: number;
  encryptedVaultKey: string;
  keyVersion: number;
  accounts: EncryptedAccountResponse[];
};

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
  userRootKey: Uint8Array;
  vaults: UnlockedVault[];
  accounts: WorkspaceAuthenticatorAccount[];
  unavailableSharedVaults: number;
};

export async function loadUnlockedVaultWorkspace(
  vaultUnlockSecret: string,
  personalVaultId: string
): Promise<UnlockedVaultWorkspace> {
  const profile = await loadProfile();
  const unlockedPersonalVault = await unlockPersonalVault(vaultUnlockSecret, profileMaterial(profile));
  return loadWorkspace(profile, personalVaultId, unlockedPersonalVault.userRootKey, unlockedPersonalVault.personalVaultKey);
}

async function loadWorkspace(
  profile: ProfileResponse,
  personalVaultId: string,
  userRootKey: Uint8Array,
  personalVaultKey: Uint8Array
): Promise<UnlockedVaultWorkspace> {
  await ensureUserEncryptionIdentity(profile, userRootKey);
  const [personalAccounts, encryptedSharedVaults] = await Promise.all([
    browserApiClient.getJson<EncryptedAccountResponse[]>(`/api/vaults/${personalVaultId}/accounts`, { cache: "no-store" }),
    browserApiClient.getJson<SharedVaultResponse[]>("/api/shared-vaults", { cache: "no-store" })
  ]);
  const personalVault: UnlockedVault = {
    id: personalVaultId,
    name: "Brankas Pribadi",
    type: "PERSONAL",
    role: "OWNER",
    key: personalVaultKey
  };
  const decryptedPersonalAccounts = await decryptAccounts(personalAccounts, personalVault);
  const sharedResults = await Promise.allSettled(encryptedSharedVaults.map(async (encryptedVault) => {
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
    return { vault, accounts: await decryptAccounts(encryptedVault.accounts, vault) };
  }));
  const sharedWorkspaces = sharedResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);

  const vaults = [personalVault, ...sharedWorkspaces.map(({ vault }) => vault)];
  const accounts = sortWorkspaceAccounts([
    ...decryptedPersonalAccounts,
    ...sharedWorkspaces.flatMap(({ accounts: sharedAccounts }) => sharedAccounts)
  ]);
  return {
    userRootKey,
    vaults,
    accounts,
    unavailableSharedVaults: sharedResults.length - sharedWorkspaces.length
  };
}

function loadProfile(): Promise<ProfileResponse> {
  return browserApiClient.getJson<ProfileResponse>("/api/user-crypto-profile", { cache: "no-store" });
}

function profileMaterial(profile: ProfileResponse) {
  return {
    vaultUnlockSalt: base64ToBytes(profile.vaultUnlockSalt),
    wrappedUserRootKey: base64ToBytes(profile.wrappedUserRootKey),
    encryptedPersonalVaultKey: base64ToBytes(profile.encryptedPersonalVaultKey),
    encryptionVersion: profile.encryptionVersion
  };
}

async function decryptAccounts(
  encryptedAccounts: EncryptedAccountResponse[],
  vault: UnlockedVault
): Promise<WorkspaceAuthenticatorAccount[]> {
  return Promise.all(encryptedAccounts.map(async (account) => ({
    id: account.id,
    vaultId: vault.id,
    vaultName: vault.name,
    vaultType: vault.type,
    revision: account.revision,
    ...await decryptAccountConfiguration(vault.key, base64ToBytes(account.encryptedPayload))
  })));
}

async function ensureUserEncryptionIdentity(profile: ProfileResponse, userRootKey: Uint8Array) {
  if (profile.userEncryptionPublicKey && profile.encryptedUserPrivateKey) return;
  const identity = await createUserEncryptionIdentity(userRootKey);
  await browserApiClient.putEmpty("/api/user-encryption-identity", {
    publicKey: identity.publicKey,
    encryptedPrivateKey: bytesToBase64(serializeEncryptedEnvelope(identity.encryptedPrivateKey)),
    encryptionVersion: 1
  });
}

function sortWorkspaceAccounts(accounts: WorkspaceAuthenticatorAccount[]): WorkspaceAuthenticatorAccount[] {
  return [...accounts].sort((left, right) =>
    left.issuer.localeCompare(right.issuer)
      || left.accountName.localeCompare(right.accountName)
      || left.vaultName.localeCompare(right.vaultName)
  );
}

"use client";

import {
  createUserEncryptionIdentity,
  serializeEncryptedEnvelope,
  unlockPersonalVault
} from "@/modules/crypto";
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
  const profile = await fetchJson<ProfileResponse>("/api/user-crypto-profile");
  const unlockedPersonalVault = await unlockPersonalVault(vaultUnlockSecret, {
    vaultUnlockSalt: fromBase64(profile.vaultUnlockSalt),
    wrappedUserRootKey: fromBase64(profile.wrappedUserRootKey),
    encryptedPersonalVaultKey: fromBase64(profile.encryptedPersonalVaultKey),
    encryptionVersion: profile.encryptionVersion
  });
  await ensureUserEncryptionIdentity(profile, unlockedPersonalVault.userRootKey);

  const [personalAccounts, encryptedSharedVaults] = await Promise.all([
    fetchJson<EncryptedAccountResponse[]>(`/api/vaults/${personalVaultId}/accounts`),
    fetchJson<SharedVaultResponse[]>("/api/shared-vaults")
  ]);
  const personalVault: UnlockedVault = {
    id: personalVaultId,
    name: "Brankas Pribadi",
    type: "PERSONAL",
    role: "OWNER",
    key: unlockedPersonalVault.personalVaultKey
  };
  const decryptedPersonalAccounts = await decryptAccounts(personalAccounts, personalVault);
  const sharedResults = await Promise.allSettled(encryptedSharedVaults.map(async (encryptedVault) => {
    const unlocked = await unlockSharedVault(
      unlockedPersonalVault.userRootKey,
      fromBase64(encryptedVault.encryptedVaultKey),
      fromBase64(encryptedVault.encryptedName)
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
    userRootKey: unlockedPersonalVault.userRootKey,
    vaults,
    accounts,
    unavailableSharedVaults: sharedResults.length - sharedWorkspaces.length
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
    ...await decryptAccountConfiguration(vault.key, fromBase64(account.encryptedPayload))
  })));
}

async function ensureUserEncryptionIdentity(profile: ProfileResponse, userRootKey: Uint8Array) {
  if (profile.userEncryptionPublicKey && profile.encryptedUserPrivateKey) return;
  const identity = await createUserEncryptionIdentity(userRootKey);
  const response = await fetch("/api/user-encryption-identity", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      publicKey: identity.publicKey,
      encryptedPrivateKey: toBase64(serializeEncryptedEnvelope(identity.encryptedPrivateKey)),
      encryptionVersion: 1
    })
  });
  if (!response.ok) throw new Error("Tidak dapat mendaftarkan identitas enkripsi pengguna.");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Request failed.");
  return response.json() as Promise<T>;
}

function sortWorkspaceAccounts(accounts: WorkspaceAuthenticatorAccount[]): WorkspaceAuthenticatorAccount[] {
  return [...accounts].sort((left, right) =>
    left.issuer.localeCompare(right.issuer)
      || left.accountName.localeCompare(right.accountName)
      || left.vaultName.localeCompare(right.vaultName)
  );
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

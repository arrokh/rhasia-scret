"use client";

import { base64ToBytes, bytesToBase64, type CancellationPort } from "@rhasia-scret/client-vault-core";
import { rotateVaultKey, serializeKeyWrapEnvelope, wrapKeyForRecipientWithContext } from "@/modules/crypto";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import {
  loadBrowserVaultKeyRotationSnapshot,
  submitBrowserVaultKeyRotation,
  type BrowserVaultKeyRotationRequest,
  type BrowserVaultKeyRotationSnapshot,
} from "./browser-vault-key-rotation-client";

export type PreparedVaultKeyRotation = {
  snapshot: BrowserVaultKeyRotationSnapshot;
  request: BrowserVaultKeyRotationRequest;
};

export type VaultKeyRotationOutcome = "COMMITTED" | "NOT_APPLIED" | "CONFLICT" | "UNKNOWN";

export async function prepareBrowserVaultKeyRotation(
  vaultId: string,
  currentVaultKey: Uint8Array,
  expectedKeyVersion: number,
  signal: AbortSignal,
): Promise<PreparedVaultKeyRotation> {
  const snapshot = await loadBrowserVaultKeyRotationSnapshot(vaultId, signal);
  if (snapshot.vaultId !== vaultId) throw new Error("Vault rotation snapshot does not match the selected Vault.");
  if (snapshot.currentKeyVersion !== expectedKeyVersion)
    throw new Error("Vault key generation changed. Refresh the workspace before rotating it.");
  if (snapshot.members.some((member) => member.keyVersion !== snapshot.currentKeyVersion))
    throw new Error("Vault member key packages are not at the current key generation.");
  if (snapshot.currentKeyVersion >= Number.MAX_SAFE_INTEGER) throw new Error("Vault key generation is exhausted.");

  const encryptedName = base64ToBytes(snapshot.encryptedName);
  const encryptedAccounts = snapshot.accounts.map(({ encryptedPayload }) => base64ToBytes(encryptedPayload));
  let rotated: Awaited<ReturnType<typeof rotateVaultKey>> | undefined;
  try {
    rotated = await rotateVaultKey(
      currentVaultKey,
      { vaultId, encryptedName, encryptedAccounts },
      cancellationPort(signal),
    );
    assertNotCancelled(signal);
    const keyVersion = snapshot.currentKeyVersion + 1;
    const memberPackages: BrowserVaultKeyRotationRequest["memberPackages"] = [];
    for (const member of snapshot.members) {
      assertNotCancelled(signal);
      const envelope = await wrapKeyForRecipientWithContext(rotated.vaultKey, member.publicKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        recipientId: member.userId,
        keyVersion,
      });
      try {
        const serialized = serializeKeyWrapEnvelope(envelope);
        try {
          memberPackages.push({
            userId: member.userId,
            expectedPublicKey: member.publicKey,
            encryptedVaultKey: bytesToBase64(serialized),
          });
        } finally {
          serialized.fill(0);
        }
      } finally {
        envelope.nonce.fill(0);
        envelope.ciphertext.fill(0);
      }
    }
    assertNotCancelled(signal);
    const request: BrowserVaultKeyRotationRequest = {
      expectedEncryptedName: snapshot.encryptedName,
      encryptedName: bytesToBase64(rotated.encryptedName),
      encryptionVersion: 1,
      expectedKeyVersion: snapshot.currentKeyVersion,
      keyVersion,
      accounts: snapshot.accounts.map((account, index) => ({
        id: account.id,
        revision: account.revision,
        encryptedPayload: bytesToBase64(rotated!.encryptedAccounts[index]!),
      })),
      memberPackages,
    };
    return { snapshot, request };
  } finally {
    encryptedName.fill(0);
    for (const account of encryptedAccounts) account.fill(0);
    if (rotated) {
      rotated.vaultKey.fill(0);
      rotated.encryptedName.fill(0);
      for (const account of rotated.encryptedAccounts) account.fill(0);
    }
  }
}

export async function submitPreparedBrowserVaultKeyRotation(
  vaultId: string,
  prepared: PreparedVaultKeyRotation,
): Promise<VaultKeyRotationOutcome> {
  try {
    await submitBrowserVaultKeyRotation(vaultId, prepared.request);
    return "COMMITTED";
  } catch (error) {
    if (error instanceof BrowserApiError && error.status === 409) return "CONFLICT";
    return reconcilePreparedBrowserVaultKeyRotation(vaultId, prepared);
  }
}

export async function reconcilePreparedBrowserVaultKeyRotation(
  vaultId: string,
  prepared: PreparedVaultKeyRotation,
): Promise<VaultKeyRotationOutcome> {
  let current: BrowserVaultKeyRotationSnapshot;
  try {
    current = await loadBrowserVaultKeyRotationSnapshot(vaultId);
  } catch {
    return "UNKNOWN";
  }
  if (matchesPreparedVaultRotation(current, prepared.request)) return "COMMITTED";
  if (matchesOriginalVaultSnapshot(current, prepared.snapshot)) return "NOT_APPLIED";
  return "CONFLICT";
}

function matchesPreparedVaultRotation(
  current: BrowserVaultKeyRotationSnapshot,
  request: BrowserVaultKeyRotationRequest,
): boolean {
  if (current.currentKeyVersion !== request.keyVersion || current.encryptedName !== request.encryptedName) return false;
  if (current.accounts.length !== request.accounts.length || current.members.length !== request.memberPackages.length)
    return false;
  const accounts = new Map(request.accounts.map((account) => [account.id, account.encryptedPayload]));
  if (!current.accounts.every((account) => accounts.get(account.id) === account.encryptedPayload)) return false;
  const packages = new Map(request.memberPackages.map((member) => [member.userId, member]));
  return current.members.every((member) => {
    const expected = packages.get(member.userId);
    return (
      expected !== undefined &&
      member.keyVersion === request.keyVersion &&
      samePublicKey(member.publicKey, expected.expectedPublicKey)
    );
  });
}

function matchesOriginalVaultSnapshot(
  current: BrowserVaultKeyRotationSnapshot,
  original: BrowserVaultKeyRotationSnapshot,
): boolean {
  if (
    current.currentKeyVersion !== original.currentKeyVersion ||
    current.encryptedName !== original.encryptedName ||
    current.accounts.length !== original.accounts.length ||
    current.members.length !== original.members.length
  )
    return false;
  const originalAccounts = new Map(original.accounts.map((account) => [account.id, account]));
  if (
    !current.accounts.every((account) => {
      const prior = originalAccounts.get(account.id);
      return (
        prior !== undefined &&
        prior.revision === account.revision &&
        prior.encryptedPayload === account.encryptedPayload
      );
    })
  )
    return false;
  const originalMembers = new Map(original.members.map((member) => [member.userId, member]));
  return current.members.every((member) => {
    const prior = originalMembers.get(member.userId);
    return (
      prior !== undefined && member.keyVersion === prior.keyVersion && samePublicKey(member.publicKey, prior.publicKey)
    );
  });
}

function samePublicKey(
  left: BrowserVaultKeyRotationSnapshot["members"][number]["publicKey"],
  right: BrowserVaultKeyRotationSnapshot["members"][number]["publicKey"],
): boolean {
  return (
    left.kty === right.kty &&
    left.crv === right.crv &&
    left.x === right.x &&
    left.y === right.y &&
    left.ext === right.ext &&
    JSON.stringify(left.key_ops) === JSON.stringify(right.key_ops)
  );
}

function cancellationPort(signal: AbortSignal): CancellationPort {
  return {
    get aborted() {
      return signal.aborted;
    },
    subscribe(listener) {
      signal.addEventListener("abort", listener, { once: true });
      return () => signal.removeEventListener("abort", listener);
    },
  };
}

function assertNotCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Vault Encryption Key rotation was cancelled.");
  error.name = "AbortError";
  throw error;
}

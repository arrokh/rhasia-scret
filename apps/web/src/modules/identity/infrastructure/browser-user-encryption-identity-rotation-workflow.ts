"use client";

import {
  base64ToBytes,
  bytesToBase64,
  type CancellationPort,
  type UserEncryptionKeyWrap,
} from "@rhasia-scret/client-vault-core";
import { rotateUserEncryptionIdentity, serializeEncryptedEnvelope } from "@/modules/crypto";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import {
  loadBrowserUserEncryptionIdentityRotationSnapshot,
  submitBrowserUserEncryptionIdentityRotation,
  parseBrowserUserEncryptionPublicKey,
  type BrowserUserEncryptionIdentityRotationRequest,
  type BrowserUserEncryptionIdentityRotationSnapshot,
} from "./browser-user-encryption-identity-rotation-client";

export type PreparedUserEncryptionIdentityRotation = {
  snapshot: BrowserUserEncryptionIdentityRotationSnapshot;
  request: BrowserUserEncryptionIdentityRotationRequest;
};

export type UserEncryptionIdentityRotationOutcome = "COMMITTED" | "NOT_APPLIED" | "CONFLICT" | "UNKNOWN";

export async function prepareBrowserUserEncryptionIdentityRotation(
  userRootKey: Uint8Array,
  profileId: string,
  expectedPublicKey: unknown,
  signal: AbortSignal,
): Promise<PreparedUserEncryptionIdentityRotation> {
  let encryptedPrivateKey: Uint8Array | undefined;
  const wraps: UserEncryptionKeyWrap[] = [];
  let rotation: Awaited<ReturnType<typeof rotateUserEncryptionIdentity>> | undefined;
  let serializedPrivateKey: Uint8Array | undefined;
  try {
    const snapshot = await loadBrowserUserEncryptionIdentityRotationSnapshot(signal);
    if (!samePublicKey(snapshot.publicKey, parseBrowserUserEncryptionPublicKey(expectedPublicKey)))
      throw new Error("User Encryption Key Pair changed. Refresh the workspace before rotating it.");
    encryptedPrivateKey = base64ToBytes(snapshot.encryptedPrivateKey);
    for (const membership of snapshot.memberships) {
      wraps.push({
        vaultId: membership.vaultId,
        recipientId: profileId,
        keyVersion: membership.keyVersion,
        encryptedVaultKey: base64ToBytes(membership.encryptedVaultKey),
      });
    }
    rotation = await rotateUserEncryptionIdentity(userRootKey, encryptedPrivateKey, wraps, cancellationPort(signal));
    assertNotCancelled(signal);
    serializedPrivateKey = serializeEncryptedEnvelope(rotation.identity.encryptedPrivateKey);
    const request: BrowserUserEncryptionIdentityRotationRequest = {
      expectedPublicKey: snapshot.publicKey,
      expectedEncryptedPrivateKey: snapshot.encryptedPrivateKey,
      expectedEncryptionVersion: snapshot.encryptionVersion,
      publicKey: parseBrowserUserEncryptionPublicKey(rotation.identity.publicKey),
      encryptedPrivateKey: bytesToBase64(serializedPrivateKey),
      encryptionVersion: snapshot.encryptionVersion,
      memberships: rotation.wrappedVaultKeys.map((wrap) => {
        const membership = snapshot.memberships.find(({ vaultId }) => vaultId === wrap.vaultId);
        if (!membership) throw new Error("Membership changed while preparing identity rotation.");
        return {
          vaultId: wrap.vaultId,
          expectedKeyVersion: wrap.keyVersion,
          expectedEncryptedVaultKey: membership.encryptedVaultKey,
          encryptedVaultKey: bytesToBase64(wrap.encryptedVaultKey),
        };
      }),
    };
    return { snapshot, request };
  } finally {
    encryptedPrivateKey?.fill(0);
    for (const wrap of wraps) wrap.encryptedVaultKey.fill(0);
    serializedPrivateKey?.fill(0);
    if (rotation) {
      rotation.identity.encryptedPrivateKey.nonce.fill(0);
      rotation.identity.encryptedPrivateKey.ciphertext.fill(0);
      for (const wrap of rotation.wrappedVaultKeys) wrap.encryptedVaultKey.fill(0);
    }
  }
}

export async function submitPreparedBrowserUserEncryptionIdentityRotation(
  prepared: PreparedUserEncryptionIdentityRotation,
): Promise<UserEncryptionIdentityRotationOutcome> {
  try {
    await submitBrowserUserEncryptionIdentityRotation(prepared.request);
    return "COMMITTED";
  } catch (error) {
    if (error instanceof BrowserApiError && error.status === 409) return "CONFLICT";
    return reconcilePreparedBrowserUserEncryptionIdentityRotation(prepared);
  }
}

export async function reconcilePreparedBrowserUserEncryptionIdentityRotation(
  prepared: PreparedUserEncryptionIdentityRotation,
): Promise<UserEncryptionIdentityRotationOutcome> {
  let current: BrowserUserEncryptionIdentityRotationSnapshot;
  try {
    current = await loadBrowserUserEncryptionIdentityRotationSnapshot();
  } catch {
    return "UNKNOWN";
  }
  if (matchesPreparedIdentityRotation(current, prepared.request)) return "COMMITTED";
  if (matchesOriginalIdentitySnapshot(current, prepared.snapshot)) return "NOT_APPLIED";
  return "CONFLICT";
}

function matchesPreparedIdentityRotation(
  current: BrowserUserEncryptionIdentityRotationSnapshot,
  request: BrowserUserEncryptionIdentityRotationRequest,
): boolean {
  if (!samePublicKey(current.publicKey, request.publicKey)) return false;
  if (current.encryptionVersion !== request.encryptionVersion) return false;
  if (current.encryptedPrivateKey !== request.encryptedPrivateKey) return false;
  if (current.memberships.length !== request.memberships.length) return false;
  const expected = new Map(request.memberships.map((membership) => [membership.vaultId, membership]));
  return current.memberships.every((membership) => {
    const rotated = expected.get(membership.vaultId);
    return (
      rotated !== undefined &&
      rotated.expectedKeyVersion === membership.keyVersion &&
      rotated.encryptedVaultKey === membership.encryptedVaultKey
    );
  });
}

function matchesOriginalIdentitySnapshot(
  current: BrowserUserEncryptionIdentityRotationSnapshot,
  original: BrowserUserEncryptionIdentityRotationSnapshot,
): boolean {
  if (!samePublicKey(current.publicKey, original.publicKey)) return false;
  if (current.encryptionVersion !== original.encryptionVersion) return false;
  if (current.encryptedPrivateKey !== original.encryptedPrivateKey) return false;
  if (current.memberships.length !== original.memberships.length) return false;
  const originalMemberships = new Map(original.memberships.map((membership) => [membership.vaultId, membership]));
  return current.memberships.every((membership) => {
    const prior = originalMemberships.get(membership.vaultId);
    return (
      prior !== undefined &&
      prior.keyVersion === membership.keyVersion &&
      prior.encryptedVaultKey === membership.encryptedVaultKey
    );
  });
}

function samePublicKey(
  left: BrowserUserEncryptionIdentityRotationSnapshot["publicKey"],
  right: BrowserUserEncryptionIdentityRotationSnapshot["publicKey"],
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
  const error = new Error("User Encryption Key Pair rotation was cancelled.");
  error.name = "AbortError";
  throw error;
}

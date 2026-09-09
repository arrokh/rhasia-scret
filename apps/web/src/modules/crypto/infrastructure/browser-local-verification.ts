"use client";

import type {
  DeviceBoundVerificationPort,
  DeviceBoundCapability,
  DeviceBoundEnrollmentRequest,
  DeviceBoundRecoveryRequest,
} from "@rhasia-scret/client-vault-core";
import { BrowserOfflineVaultRepository } from "@/modules/sync";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { evaluatePasskeyPrf } from "./browser-passkey-prf";
import {
  createPasskeyRecoveryPackage,
  passkeyRecoverySalt,
  recoverUserRootKeyFromPasskeyPackage,
} from "./browser-passkey-recovery-package";

export class RememberedBrowserBindingError extends Error {
  public constructor() {
    super("The Remembered Browser package is not valid for this site.");
    this.name = "RememberedBrowserBindingError";
  }
}

export function supportsLocalVerification(): boolean {
  return (
    typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials
  );
}

export async function enrollRememberedBrowser(
  profileId: string,
  userRootKey: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  if (!supportsLocalVerification()) throw new Error("Local Verification is unavailable in this browser.");
  if (userRootKey.length !== 32) throw new Error("User Root Key is invalid.");
  const rpId = window.location.hostname;
  throwIfAborted(signal);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { id: rpId, name: "rhasia-scret" },
      user: { id: randomBytes(32), name: `offline-${profileId}`, displayName: "rhasia-scret" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!(credential instanceof PublicKeyCredential))
    throw new DOMException("Local Verification enrollment was cancelled.", "NotAllowedError");
  throwIfAborted(signal);
  const retainedUserRootKey = userRootKey.slice();
  const prfSalt = randomBytes(32);
  let prfOutput: Uint8Array | undefined;
  let encryptedPackage: Uint8Array | undefined;
  try {
    prfOutput = await evaluatePasskeyPrf(new Uint8Array(credential.rawId), rpId, prfSalt);
    throwIfAborted(signal);
    encryptedPackage = await createPasskeyRecoveryPackage(retainedUserRootKey, prfOutput, prfSalt);
    throwIfAborted(signal);
    await new BrowserOfflineVaultRepository().saveRememberedBrowser({
      version: 1,
      profileId,
      rpId,
      origin: window.location.origin,
      credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
      encryptedUserRootKeyPackage: bytesToBase64(encryptedPackage),
      enrolledAt: new Date().toISOString(),
    });
  } finally {
    retainedUserRootKey.fill(0);
    prfOutput?.fill(0);
    encryptedPackage?.fill(0);
    prfSalt.fill(0);
  }
}

export async function recoverUserRootKeyWithRememberedBrowser(
  profileId: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!supportsLocalVerification()) throw new Error("Local Verification is unavailable in this browser.");
  const browserPackage = await new BrowserOfflineVaultRepository().readRememberedBrowser(profileId);
  if (!browserPackage) throw new Error("No Remembered Browser package exists for this profile.");
  assertCurrentSite(browserPackage.origin, browserPackage.rpId);

  throwIfAborted(signal);
  const encryptedPackage = base64ToBytes(browserPackage.encryptedUserRootKeyPackage);
  let prfSalt: Uint8Array | undefined;
  let prfOutput: Uint8Array | undefined;
  try {
    prfSalt = passkeyRecoverySalt(encryptedPackage);
    prfOutput = await evaluatePasskeyPrf(base64ToBytes(browserPackage.credentialId), browserPackage.rpId, prfSalt);
    throwIfAborted(signal);
    const recovered = await recoverUserRootKeyFromPasskeyPackage(prfOutput, encryptedPackage);
    if (signal?.aborted) {
      recovered.userRootKey.fill(0);
      recovered.prfSalt.fill(0);
      throwIfAborted(signal);
    }
    recovered.prfSalt.fill(0);
    return recovered.userRootKey;
  } finally {
    prfOutput?.fill(0);
    prfSalt?.fill(0);
    encryptedPackage.fill(0);
  }
}

export async function rememberedBrowserEnrollment(profileId: string): Promise<{ enrolledAt: string } | null> {
  const browserPackage = await new BrowserOfflineVaultRepository().readRememberedBrowser(profileId);
  if (!browserPackage) return null;
  assertCurrentSite(browserPackage.origin, browserPackage.rpId);
  return { enrolledAt: browserPackage.enrolledAt };
}

export async function hasRememberedBrowserForPersonalVault(personalVaultId: string): Promise<boolean> {
  if (!supportsLocalVerification()) return false;
  const repository = new BrowserOfflineVaultRepository();
  const profiles = await repository.listProfiles();
  for (const profile of profiles) {
    if (profile.personalVaultId !== personalVaultId) continue;
    try {
      const browserPackage = await repository.readRememberedBrowser(profile.profileId);
      if (!browserPackage) continue;
      assertCurrentSite(browserPackage.origin, browserPackage.rpId);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function forgetRememberedBrowser(profileId: string): Promise<void> {
  await new BrowserOfflineVaultRepository().removeRememberedBrowser(profileId);
}

export class BrowserDeviceBoundVerificationPort implements DeviceBoundVerificationPort {
  async capability(): Promise<DeviceBoundCapability> {
    if (typeof window === "undefined" || !window.isSecureContext)
      return { supported: false, kind: "unsupported", reason: "secure-context-required" };
    if (!window.PublicKeyCredential || !navigator.credentials)
      return { supported: false, kind: "unsupported", reason: "user-verification-unavailable" };
    try {
      const capabilities = await window.PublicKeyCredential.getClientCapabilities();
      if (capabilities.prf !== true) return { supported: false, kind: "unsupported", reason: "prf-unavailable" };
    } catch {
      return { supported: false, kind: "unsupported", reason: "prf-unavailable" };
    }
    return { supported: true, kind: "browser-webauthn-prf" };
  }

  async enroll(request: DeviceBoundEnrollmentRequest): Promise<{ enrolledAt: string }> {
    await enrollRememberedBrowser(request.profileId, request.userRootKey, request.signal as AbortSignal | undefined);
    const enrollment = await rememberedBrowserEnrollment(request.profileId);
    if (!enrollment) throw new Error("Remembered Browser enrollment was not persisted.");
    return enrollment;
  }

  recover(request: DeviceBoundRecoveryRequest): Promise<Uint8Array> {
    return recoverUserRootKeyWithRememberedBrowser(request.profileId, request.signal as AbortSignal | undefined);
  }
}

export const browserDeviceBoundVerificationPort = new BrowserDeviceBoundVerificationPort();

function assertCurrentSite(origin: string, rpId: string): void {
  if (origin !== window.location.origin || rpId !== window.location.hostname) throw new RememberedBrowserBindingError();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Remembered Browser operation was cancelled.", "AbortError");
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

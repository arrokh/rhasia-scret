"use client";

import { BrowserOfflineVaultRepository } from "@/modules/sync";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { evaluatePasskeyPrf } from "./browser-passkey-prf";
import { createPasskeyRecoveryPackage, passkeyRecoverySalt, recoverUserRootKeyFromPasskeyPackage } from "./browser-passkey-recovery-package";

export function supportsLocalVerification(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;
}

export async function enrollRememberedBrowser(profileId: string, userRootKey: Uint8Array): Promise<void> {
  if (!supportsLocalVerification()) throw new Error("Verifikasi Lokal tidak tersedia di browser ini.");
  const rpId = window.location.hostname;
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { id: rpId, name: "rhasia-scret" },
      user: { id: randomBytes(32), name: `offline-${profileId}`, displayName: "Browser yang Diingat" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs
    }
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Pendaftaran Verifikasi Lokal dibatalkan.");

  const prfSalt = randomBytes(32);
  let prfOutput: Uint8Array | undefined;
  let encryptedPackage: Uint8Array | undefined;
  try {
    prfOutput = await evaluatePasskeyPrf(new Uint8Array(credential.rawId), rpId, prfSalt);
    encryptedPackage = await createPasskeyRecoveryPackage(userRootKey, prfOutput, prfSalt);
    await new BrowserOfflineVaultRepository().saveRememberedBrowser({
      version: 1,
      profileId,
      rpId,
      origin: window.location.origin,
      credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
      encryptedUserRootKeyPackage: bytesToBase64(encryptedPackage),
      enrolledAt: new Date().toISOString()
    });
  } finally {
    prfOutput?.fill(0);
    encryptedPackage?.fill(0);
    prfSalt.fill(0);
  }
}

export async function recoverUserRootKeyWithRememberedBrowser(profileId: string): Promise<Uint8Array> {
  if (!supportsLocalVerification()) throw new Error("Verifikasi Lokal tidak tersedia di browser ini.");
  const browserPackage = await new BrowserOfflineVaultRepository().readRememberedBrowser(profileId);
  if (!browserPackage) throw new Error("Browser ini belum diingat.");
  if (browserPackage.origin !== window.location.origin || browserPackage.rpId !== window.location.hostname) throw new Error("Paket Browser yang Diingat tidak berlaku untuk situs ini.");

  const encryptedPackage = base64ToBytes(browserPackage.encryptedUserRootKeyPackage);
  const prfSalt = passkeyRecoverySalt(encryptedPackage);
  let prfOutput: Uint8Array | undefined;
  try {
    prfOutput = await evaluatePasskeyPrf(base64ToBytes(browserPackage.credentialId), browserPackage.rpId, prfSalt);
    const recovered = await recoverUserRootKeyFromPasskeyPackage(prfOutput, encryptedPackage);
    recovered.prfSalt.fill(0);
    return recovered.userRootKey;
  } finally {
    prfOutput?.fill(0);
    prfSalt.fill(0);
    encryptedPackage.fill(0);
  }
}

export async function forgetRememberedBrowser(profileId: string): Promise<void> {
  await new BrowserOfflineVaultRepository().removeRememberedBrowser(profileId);
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";

const CREDENTIAL_KEY = "shared-totp-vault:remembered-browser-credential";

export function supportsLocalVerification(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

export async function enrollRememberedBrowser(): Promise<void> {
  if (!supportsLocalVerification()) throw new Error("Verifikasi Lokal tidak tersedia di browser ini.");
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "rhasia-scret" },
      user: { id: randomBytes(32), name: "remembered-browser", displayName: "Browser yang Diingat" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000
    }
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Pendaftaran Verifikasi Lokal dibatalkan.");
  window.localStorage.setItem(CREDENTIAL_KEY, bytesToBase64(new Uint8Array(credential.rawId)));
}

export async function verifyRememberedBrowser(): Promise<boolean> {
  const encodedCredentialId = window.localStorage.getItem(CREDENTIAL_KEY);
  if (!encodedCredentialId || !supportsLocalVerification()) return false;
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: base64ToBytes(encodedCredentialId) }],
      userVerification: "required",
      timeout: 60_000
    }
  });
  return assertion instanceof PublicKeyCredential;
}

export function forgetRememberedBrowser(): void {
  window.localStorage.removeItem(CREDENTIAL_KEY);
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

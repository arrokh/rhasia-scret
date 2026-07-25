"use client";

const CREDENTIAL_KEY = "shared-totp-vault:remembered-browser-credential";

export function supportsLocalVerification(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

export async function enrollRememberedBrowser(): Promise<void> {
  if (!supportsLocalVerification()) throw new Error("Local Verification is unavailable in this browser.");
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "Shared TOTP Vault" },
      user: { id: randomBytes(32), name: "remembered-browser", displayName: "Remembered Browser" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000
    }
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Local Verification enrollment was cancelled.");
  window.localStorage.setItem(CREDENTIAL_KEY, toBase64(new Uint8Array(credential.rawId)));
}

export async function verifyRememberedBrowser(): Promise<boolean> {
  const encodedCredentialId = window.localStorage.getItem(CREDENTIAL_KEY);
  if (!encodedCredentialId || !supportsLocalVerification()) return false;
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: fromBase64(encodedCredentialId) }],
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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export function loadPasskeyRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return browserApiClient.postJson("/api/passkey-recovery/registration/options", undefined, { cache: "no-store" });
}

export function verifyPasskeyRegistration(request: {
  response: unknown;
  encryptedRecoveryPackage: string;
}): Promise<void> {
  return browserApiClient.postEmpty("/api/passkey-recovery/registration/verify", request);
}

export function loadPasskeyAuthenticationOptions(): Promise<
  PublicKeyCredentialRequestOptionsJSON & { encryptedRecoveryPackage: string }
> {
  return browserApiClient.postJson("/api/passkey-recovery/authentication/options", undefined, { cache: "no-store" });
}

export function verifyPasskeyAuthentication(response: unknown): Promise<{ encryptedRecoveryPackage: string }> {
  return browserApiClient.postJson("/api/passkey-recovery/authentication/verify", { response });
}

export function rewrapUserCryptoProfile(request: {
  vaultUnlockSalt: string;
  wrappedUserRootKey: string;
  encryptedPersonalVaultKey?: string;
  encryptionVersion: number;
}): Promise<void> {
  return browserApiClient.postEmpty("/api/user-crypto-profile/rewrap", request);
}

export function rewrapUserRootKey(request: {
  vaultUnlockSalt: string;
  wrappedUserRootKey: string;
  encryptionVersion: number;
}): Promise<void> {
  return rewrapUserCryptoProfile(request);
}

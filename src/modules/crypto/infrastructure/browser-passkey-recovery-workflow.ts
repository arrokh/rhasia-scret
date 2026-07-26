"use client";

import { base64ToBytes, base64UrlToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { createPasskeyRecoveryPackage, passkeyRecoverySalt, recoverUserRootKeyFromPasskeyPackage } from "./browser-passkey-recovery-package";
import {
  loadPasskeyAuthenticationOptions,
  loadPasskeyRegistrationOptions,
  rewrapUserRootKey,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from "./browser-passkey-recovery-client";
import { authenticatePasskey, createPasskeyCredential, evaluatePasskeyPrf } from "./browser-passkey-prf";
import { wrapUserRootKeyWithVaultUnlockSecret } from "./browser-vault-unlock-secret-change";

export async function enrollPasskeyRecovery(userRootKey: Uint8Array): Promise<void> {
  const options = await loadPasskeyRegistrationOptions();
  const credential = await createPasskeyCredential(options);
  try {
    const encryptedRecoveryPackage = bytesToBase64(
      await createPasskeyRecoveryPackage(userRootKey, credential.prfOutput, credential.prfSalt)
    );
    await verifyPasskeyRegistration({ response: credential.registrationResponse, encryptedRecoveryPackage });
  } finally {
    credential.prfOutput.fill(0);
  }
}

export async function recoverUserRootKeyWithPasskey(): Promise<Uint8Array> {
  let prfOutput: Uint8Array | undefined;
  try {
    const options = await loadPasskeyAuthenticationOptions();
    const credential = requiredRecoveryCredential(options);
    const assertionResponse = await authenticatePasskey(options);
    const recovery = await verifyPasskeyAuthentication(assertionResponse);
    const packageBytes = base64ToBytes(recovery.encryptedRecoveryPackage);
    prfOutput = await evaluatePasskeyPrf(
      base64UrlToBytes(credential.id),
      credential.rpId,
      passkeyRecoverySalt(packageBytes)
    );
    return (await recoverUserRootKeyFromPasskeyPackage(prfOutput, packageBytes)).userRootKey;
  } finally {
    prfOutput?.fill(0);
  }
}

export async function resetVaultUnlockSecretWithPasskey(secret: string): Promise<void> {
  let userRootKey: Uint8Array | undefined;
  try {
    userRootKey = await recoverUserRootKeyWithPasskey();
    const rewrapped = await wrapUserRootKeyWithVaultUnlockSecret(userRootKey, secret);
    await rewrapUserRootKey({
      vaultUnlockSalt: bytesToBase64(rewrapped.vaultUnlockSalt),
      wrappedUserRootKey: bytesToBase64(rewrapped.wrappedUserRootKey),
      encryptionVersion: 1
    });
  } finally {
    userRootKey?.fill(0);
  }
}

function requiredRecoveryCredential(options: PublicKeyCredentialRequestOptionsJSON): { id: string; rpId: string } {
  const id = options.allowCredentials?.[0]?.id;
  if (!id || !options.rpId) throw new Error("Passkey recovery options are incomplete.");
  return { id, rpId: options.rpId };
}

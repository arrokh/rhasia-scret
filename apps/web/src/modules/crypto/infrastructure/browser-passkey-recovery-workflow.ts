"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import {
  createPasskeyRecoveryPackage,
  passkeyRecoverySalt,
  recoverUserRootKeyFromPasskeyPackage,
} from "./browser-passkey-recovery-package";
import {
  loadPasskeyAuthenticationOptions,
  loadPasskeyRegistrationOptions,
  rewrapUserRootKey,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "./browser-passkey-recovery-client";
import { authenticatePasskey, createPasskeyCredential } from "./browser-passkey-prf";
import { wrapUserRootKeyWithVaultUnlockSecret } from "./browser-vault-unlock-secret-change";

export async function enrollPasskeyRecovery(userRootKey: Uint8Array): Promise<void> {
  const options = await loadPasskeyRegistrationOptions();
  const credential = await createPasskeyCredential(options);
  try {
    const encryptedRecoveryPackage = bytesToBase64(
      await createPasskeyRecoveryPackage(userRootKey, credential.prfOutput, credential.prfSalt),
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
    requiredRecoveryCredential(options);
    const packageBytes = base64ToBytes(options.encryptedRecoveryPackage);
    try {
      const prfSalt = passkeyRecoverySalt(packageBytes);
      try {
        const assertion = await authenticatePasskey(options, prfSalt);
        prfOutput = assertion.prfOutput;
        const recovery = await verifyPasskeyAuthentication(assertion.response);
        if (recovery.encryptedRecoveryPackage !== options.encryptedRecoveryPackage)
          throw new Error("Passkey recovery package changed.");
        return (await recoverUserRootKeyFromPasskeyPackage(prfOutput, packageBytes)).userRootKey;
      } finally {
        prfSalt.fill(0);
      }
    } finally {
      packageBytes.fill(0);
    }
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
      encryptionVersion: 1,
    });
  } finally {
    userRootKey?.fill(0);
  }
}

function requiredRecoveryCredential(options: PublicKeyCredentialRequestOptionsJSON): void {
  if (!options.allowCredentials?.[0]?.id || !options.rpId) throw new Error("Passkey recovery options are incomplete.");
}

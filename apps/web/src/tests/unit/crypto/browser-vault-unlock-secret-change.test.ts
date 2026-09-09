import { describe, expect, it } from "vitest";
import {
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";
import { initializePersonalVaultInBrowser } from "@/modules/crypto/infrastructure/browser-personal-vault-initializer";
import {
  changeVaultUnlockSecret,
  wrapUserRootKeyWithVaultUnlockSecret,
} from "@/modules/crypto/infrastructure/browser-vault-unlock-secret-change";
import { deriveVaultUnlockKey } from "@/modules/crypto/infrastructure/browser-vault-unlock-key";

describe("changeVaultUnlockSecret", () => {
  it("re-wraps the User Root Key without changing the Personal Vault Encryption Key", async () => {
    const currentSecret = "alpha bravo charlie delta echo foxtrot";
    const nextSecret = "golf hotel india juliet kilo lima";
    const material = await initializePersonalVaultInBrowser(currentSecret, "Personal Vault");
    const changed = await changeVaultUnlockSecret(
      currentSecret,
      nextSecret,
      material.vaultUnlockSalt,
      material.wrappedUserRootKey,
    );
    const rootKey = await decryptPayloadWithContext(
      await deriveVaultUnlockKey(nextSecret, changed.vaultUnlockSalt),
      deserializeEncryptedEnvelope(changed.wrappedUserRootKey),
      { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
    );
    await expect(
      decryptPayloadWithContext(rootKey, deserializeEncryptedEnvelope(material.encryptedPersonalVaultKey), {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        keyVersion: 1,
      }),
    ).resolves.toHaveLength(32);
    await expect(
      decryptPayloadWithContext(
        await deriveVaultUnlockKey(currentSecret, material.vaultUnlockSalt),
        deserializeEncryptedEnvelope(changed.wrappedUserRootKey),
        { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
      ),
    ).rejects.toThrow("authentication failed");
  });

  it("wraps a passkey-recovered User Root Key directly under a new secret", async () => {
    const userRootKey = crypto.getRandomValues(new Uint8Array(32));
    const nextSecret = "november oscar papa quebec romeo sierra";

    const rewrapped = await wrapUserRootKeyWithVaultUnlockSecret(userRootKey, nextSecret);

    await expect(
      decryptPayloadWithContext(
        await deriveVaultUnlockKey(nextSecret, rewrapped.vaultUnlockSalt),
        deserializeEncryptedEnvelope(rewrapped.wrappedUserRootKey),
        { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 },
      ),
    ).resolves.toEqual(userRootKey);
  });
});

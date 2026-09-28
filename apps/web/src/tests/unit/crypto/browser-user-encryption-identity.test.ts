import { describe, expect, it } from "vitest";
import {
  encryptPayload,
  encryptPayloadWithContext,
  generateSymmetricKey,
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";
import { UserEncryptionPrivateKeyRecoveryError, userEncryptionIdentityContext } from "@rhasia-scret/client-vault-core";
import {
  createUserEncryptionIdentity,
  recoverUserEncryptionPrivateKey,
} from "@/modules/crypto/infrastructure/browser-user-encryption-identity";

describe("user encryption identity", () => {
  it("backs up a private ECDH key encrypted under the User Root Key", async () => {
    const rootKey = generateSymmetricKey();
    const identity = await createUserEncryptionIdentity(rootKey);
    expect(identity.publicKey.kty).toBe("EC");
    await expect(recoverUserEncryptionPrivateKey(rootKey, identity.encryptedPrivateKey)).resolves.toMatchObject({
      kty: "EC",
      d: expect.any(String),
    });
    await expect(
      recoverUserEncryptionPrivateKey(generateSymmetricKey(), identity.encryptedPrivateKey),
    ).rejects.toMatchObject({
      name: "UserEncryptionPrivateKeyRecoveryError",
      stage: "decryption-failed",
    } satisfies Partial<UserEncryptionPrivateKeyRecoveryError>);
  });

  it("separates legacy envelopes from failed authentication and invalid private-key payloads", async () => {
    const rootKey = generateSymmetricKey();
    const legacyPlaintext = new TextEncoder().encode(JSON.stringify({ kty: "EC" }));
    const legacyEnvelope = await encryptPayload(rootKey, legacyPlaintext);
    legacyPlaintext.fill(0);
    await expect(recoverUserEncryptionPrivateKey(rootKey, legacyEnvelope)).rejects.toMatchObject({
      name: "UserEncryptionPrivateKeyRecoveryError",
      stage: "legacy-envelope",
    });

    const invalidPayload = new TextEncoder().encode(JSON.stringify({ kty: "EC", crv: "P-256" }));
    const invalidPrivateKeyEnvelope = await encryptPayloadWithContext(
      rootKey,
      invalidPayload,
      userEncryptionIdentityContext(),
    );
    invalidPayload.fill(0);
    await expect(recoverUserEncryptionPrivateKey(rootKey, invalidPrivateKeyEnvelope)).rejects.toMatchObject({
      name: "UserEncryptionPrivateKeyRecoveryError",
      stage: "payload-invalid",
    });
  });
});

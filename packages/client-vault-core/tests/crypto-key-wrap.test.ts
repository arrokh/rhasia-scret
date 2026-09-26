import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  createClientCryptoPort,
  createUserEncryptionIdentityWithCrypto,
  recoverUserEncryptionPrivateKeyWithCrypto,
  rotateUserEncryptionIdentityWithCrypto,
  rotateVaultKeyWithCrypto,
  unlockSharedVaultWithCrypto,
  type ClientCryptoPort,
  type CryptoPrimitivePort,
  type PortableEcdhKeyPair,
  type PortableJsonWebKey,
} from "../src/index";

describe("client crypto key-wrap protocol", () => {
  it("wraps and unwraps context-bound keys while rejecting context substitution", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const pair = await crypto.generateUserEncryptionKeyPair();
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const context = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId: "vault-1",
      keyVersion: 1,
    } as const;
    const envelope = await crypto.wrapKeyForRecipientWithContext(vaultKey, pair.publicKey, context);
    const serialized = crypto.serializeKeyWrapEnvelope(envelope);

    await expect(
      crypto.unwrapKeyForRecipientWithContext(crypto.deserializeKeyWrapEnvelope(serialized), pair.privateKey, context),
    ).resolves.toEqual(vaultKey);
    await expect(
      crypto.unwrapKeyForRecipientWithContext(envelope, pair.privateKey, { ...context, vaultId: "vault-2" }),
    ).rejects.toThrow("authentication failed");
    vaultKey.fill(0);
  });

  it("keeps legacy key-wrap compatibility behind the explicit context-free API", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const pair = await crypto.generateUserEncryptionKeyPair();
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => 31 - index);
    const envelope = await crypto.wrapKeyForRecipient(vaultKey, pair.publicKey);

    expect(envelope.version).toBe(1);
    await expect(crypto.unwrapKeyForRecipient(envelope, pair.privateKey)).resolves.toEqual(vaultKey);
    expect(() =>
      crypto.unwrapKeyForRecipientWithContext(envelope, pair.privateKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        keyVersion: 1,
      }),
    ).toThrow("explicit migration");
    vaultKey.fill(0);
  });

  it("creates, recovers, and rotates a user encryption identity with per-membership contexts", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const rootKey = new Uint8Array(32).fill(5);
    const vaultKey = new Uint8Array(32).fill(6);
    const membership = { vaultId: "vault-1", recipientId: "user-1", keyVersion: 3 } as const;
    const context = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      ...membership,
    } as const;
    const original = await createUserEncryptionIdentityWithCrypto(rootKey, crypto);
    const originalPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(
      rootKey,
      original.encryptedPrivateKey,
      crypto,
    );
    const wrapped = crypto.serializeKeyWrapEnvelope(
      await crypto.wrapKeyForRecipientWithContext(vaultKey, original.publicKey, context),
    );
    const rotated = await rotateUserEncryptionIdentityWithCrypto(
      rootKey,
      crypto.serializeEncryptedEnvelope(original.encryptedPrivateKey),
      [{ ...membership, encryptedVaultKey: wrapped }],
      crypto,
    );
    const rotatedPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(
      rootKey,
      rotated.identity.encryptedPrivateKey,
      crypto,
    );

    expect(originalPrivateKey.d).toBeTypeOf("string");
    expect(rotated.wrappedVaultKeys[0]).toMatchObject(membership);
    await expect(
      crypto.unwrapKeyForRecipientWithContext(
        crypto.deserializeKeyWrapEnvelope(rotated.wrappedVaultKeys[0]!.encryptedVaultKey),
        rotatedPrivateKey,
        context,
      ),
    ).resolves.toEqual(vaultKey);
    rootKey.fill(0);
    vaultKey.fill(0);
  });

  it("migrates a legacy User-Root-Key membership package to the new ECDH identity during rotation", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const rootKey = new Uint8Array(32).fill(4);
    const vaultKey = new Uint8Array(32).fill(12);
    const original = await createUserEncryptionIdentityWithCrypto(rootKey, crypto);
    const membership = { vaultId: "vault-legacy", recipientId: "user-1", keyVersion: 1 } as const;
    const legacyPackage = crypto.serializeEncryptedEnvelope(
      await crypto.encryptPayloadWithContext(rootKey, vaultKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId: membership.vaultId,
        keyVersion: membership.keyVersion,
      }),
    );

    const rotated = await rotateUserEncryptionIdentityWithCrypto(
      rootKey,
      crypto.serializeEncryptedEnvelope(original.encryptedPrivateKey),
      [{ ...membership, encryptedVaultKey: legacyPackage }],
      crypto,
    );
    const nextPrivateKey = await recoverUserEncryptionPrivateKeyWithCrypto(
      rootKey,
      rotated.identity.encryptedPrivateKey,
      crypto,
    );
    const migrated = crypto.deserializeKeyWrapEnvelope(rotated.wrappedVaultKeys[0]!.encryptedVaultKey);
    const unwrapped = await crypto.unwrapKeyForRecipientWithContext(migrated, nextPrivateKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      vaultId: membership.vaultId,
      recipientId: membership.recipientId,
      keyVersion: membership.keyVersion,
    });

    expect(unwrapped).toEqual(vaultKey);
    expect(rotated.wrappedVaultKeys[0]!.encryptedVaultKey[0]).toBe(0x7b);
    unwrapped.fill(0);
    migrated.nonce.fill(0);
    migrated.ciphertext.fill(0);
    rootKey.fill(0);
    vaultKey.fill(0);
  });

  it("rejects user identity rotation when a package is bound to another membership", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const rootKey = new Uint8Array(32).fill(8);
    const vaultKey = new Uint8Array(32).fill(9);
    const original = await createUserEncryptionIdentityWithCrypto(rootKey, crypto);
    const envelope = crypto.serializeKeyWrapEnvelope(
      await crypto.wrapKeyForRecipientWithContext(vaultKey, original.publicKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId: "vault-1",
        recipientId: "user-1",
        keyVersion: 2,
      }),
    );

    await expect(
      rotateUserEncryptionIdentityWithCrypto(
        rootKey,
        crypto.serializeEncryptedEnvelope(original.encryptedPrivateKey),
        [{ vaultId: "vault-2", recipientId: "user-1", keyVersion: 2, encryptedVaultKey: envelope }],
        crypto,
      ),
    ).rejects.toThrow("authentication failed");
    rootKey.fill(0);
    vaultKey.fill(0);
  });

  it("cancels user identity rotation between membership wraps and clears temporary envelopes", async () => {
    const baseCrypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const rootKey = new Uint8Array(32).fill(10);
    const vaultKey = new Uint8Array(32).fill(13);
    const original = await createUserEncryptionIdentityWithCrypto(rootKey, baseCrypto);
    const membership = { vaultId: "vault-1", recipientId: "user-1", keyVersion: 1 } as const;
    const context = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      ...membership,
    } as const;
    const originalWrap = baseCrypto.serializeKeyWrapEnvelope(
      await baseCrypto.wrapKeyForRecipientWithContext(vaultKey, original.publicKey, context),
    );
    let cancelled = false;
    let generatedWrap: Awaited<ReturnType<ClientCryptoPort["wrapKeyForRecipientWithContext"]>> | undefined;
    const crypto: ClientCryptoPort = {
      ...baseCrypto,
      wrapKeyForRecipientWithContext: async (key, recipient, keyContext) => {
        generatedWrap = await baseCrypto.wrapKeyForRecipientWithContext(key, recipient, keyContext);
        cancelled = true;
        return generatedWrap;
      },
    };
    const signal = {
      get aborted() {
        return cancelled;
      },
      subscribe: () => () => undefined,
    };

    await expect(
      rotateUserEncryptionIdentityWithCrypto(
        rootKey,
        baseCrypto.serializeEncryptedEnvelope(original.encryptedPrivateKey),
        [{ ...membership, encryptedVaultKey: originalWrap }],
        crypto,
        signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generatedWrap).toBeDefined();
    expect([...generatedWrap!.ciphertext].every((byte) => byte === 0)).toBe(true);
    rootKey.fill(0);
    vaultKey.fill(0);
  });

  it("opens ECDH and existing User-Root-Key member packages without cross-format fallback", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const rootKey = new Uint8Array(32).fill(14);
    const vaultKey = new Uint8Array(32).fill(15);
    const name = new TextEncoder().encode("Synthetic Shared Vault");
    const vaultId = "vault-1";
    const recipientId = "user-1";
    const keyVersion = 2;
    const identity = await createUserEncryptionIdentityWithCrypto(rootKey, crypto);
    const encryptedName = crypto.serializeEncryptedEnvelope(
      await crypto.encryptPayloadWithContext(vaultKey, name, {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      }),
    );
    const ecdhPackage = crypto.serializeKeyWrapEnvelope(
      await crypto.wrapKeyForRecipientWithContext(vaultKey, identity.publicKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        recipientId,
        keyVersion,
      }),
    );

    const openedEcdh = await unlockSharedVaultWithCrypto(crypto, rootKey, ecdhPackage, encryptedName, {
      vaultId,
      recipientId,
      keyVersion,
      userEncryptionPrivateKey: await recoverUserEncryptionPrivateKeyWithCrypto(
        rootKey,
        identity.encryptedPrivateKey,
        crypto,
      ),
    });
    expect(openedEcdh.name).toBe("Synthetic Shared Vault");
    expect(openedEcdh.vaultKey).toEqual(vaultKey);

    const rootKeyPackage = crypto.serializeEncryptedEnvelope(
      await crypto.encryptPayloadWithContext(rootKey, vaultKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        keyVersion: 1,
      }),
    );
    const openedLegacy = await unlockSharedVaultWithCrypto(crypto, rootKey, rootKeyPackage, encryptedName, {
      vaultId,
      recipientId,
      keyVersion: 1,
    });
    expect(openedLegacy.name).toBe("Synthetic Shared Vault");
    expect(openedLegacy.vaultKey).toEqual(vaultKey);

    await expect(
      unlockSharedVaultWithCrypto(crypto, rootKey, ecdhPackage, encryptedName, {
        vaultId,
        recipientId,
        keyVersion,
      }),
    ).rejects.toThrow("User Encryption Key Pair is unavailable.");
    openedEcdh.vaultKey.fill(0);
    openedLegacy.vaultKey.fill(0);
    rootKey.fill(0);
    vaultKey.fill(0);
    name.fill(0);
  });

  it("rotates Vault Encryption Key payloads while clearing intermediate plaintext", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const oldKey = new Uint8Array(32).fill(7);
    const name = new TextEncoder().encode("encrypted-name-placeholder");
    const account = new TextEncoder().encode("encrypted-account-placeholder");
    const nameContext = {
      purpose: "vault-name",
      payloadType: "vault-name",
      vaultId: "vault-1",
      keyVersion: 1,
    } as const;
    const accountContext = {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      vaultId: "vault-1",
      keyVersion: 1,
    } as const;
    const encryptedName = crypto.serializeEncryptedEnvelope(
      await crypto.encryptPayloadWithContext(oldKey, name, nameContext),
    );
    const encryptedAccount = crypto.serializeEncryptedEnvelope(
      await crypto.encryptPayloadWithContext(oldKey, account, accountContext),
    );
    const rotated = await rotateVaultKeyWithCrypto(
      oldKey,
      { encryptedName, encryptedAccounts: [encryptedAccount], vaultId: "vault-1" },
      crypto,
    );

    await expect(
      crypto.decryptPayloadWithContext(
        rotated.vaultKey,
        crypto.deserializeEncryptedEnvelope(rotated.encryptedName),
        nameContext,
      ),
    ).resolves.toEqual(name);
    await expect(
      crypto.decryptPayloadWithContext(
        rotated.vaultKey,
        crypto.deserializeEncryptedEnvelope(rotated.encryptedAccounts[0]!),
        accountContext,
      ),
    ).resolves.toEqual(account);
    rotated.vaultKey.fill(0);
    oldKey.fill(0);
    name.fill(0);
    account.fill(0);
  });

  it("migrates context-free legacy account envelopes into context-bound Vault ciphertext", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const oldKey = new Uint8Array(32).fill(18);
    const vaultId = "vault-legacy";
    const name = new TextEncoder().encode("Synthetic legacy name");
    const account = new Uint8Array([4, 5, 6]);
    const encryptedName = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(oldKey, name));
    const encryptedAccount = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(oldKey, account));

    const rotated = await rotateVaultKeyWithCrypto(
      oldKey,
      { vaultId, encryptedName, encryptedAccounts: [encryptedAccount] },
      crypto,
    );
    const rotatedName = crypto.deserializeEncryptedEnvelope(rotated.encryptedName);
    const rotatedAccount = crypto.deserializeEncryptedEnvelope(rotated.encryptedAccounts[0]!);

    await expect(
      crypto.decryptPayloadWithContext(rotated.vaultKey, rotatedName, {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      }),
    ).resolves.toEqual(name);
    await expect(
      crypto.decryptPayloadWithContext(rotated.vaultKey, rotatedAccount, {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        vaultId,
        keyVersion: 1,
      }),
    ).resolves.toEqual(account);

    rotated.vaultKey.fill(0);
    rotatedName.nonce.fill(0);
    rotatedName.ciphertext.fill(0);
    rotatedAccount.nonce.fill(0);
    rotatedAccount.ciphertext.fill(0);
    oldKey.fill(0);
    name.fill(0);
    account.fill(0);
  });

  it("cancels Vault Encryption Key rotation between crypto steps and clears its generated key", async () => {
    const baseCrypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const oldKey = new Uint8Array(32).fill(11);
    const nameContext = { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 } as const;
    const encryptedName = baseCrypto.serializeEncryptedEnvelope(
      await baseCrypto.encryptPayloadWithContext(oldKey, new TextEncoder().encode("synthetic"), nameContext),
    );
    let cancelled = false;
    let generatedKey: Uint8Array | undefined;
    const crypto: ClientCryptoPort = {
      ...baseCrypto,
      generateSymmetricKey: () => {
        generatedKey = baseCrypto.generateSymmetricKey();
        return generatedKey;
      },
      decryptPayloadWithContext: async (key, envelope, context) => {
        const plaintext = await baseCrypto.decryptPayloadWithContext(key, envelope, context);
        if (context.purpose === "vault-name") cancelled = true;
        return plaintext;
      },
    };
    const signal = {
      get aborted() {
        return cancelled;
      },
      subscribe: () => () => undefined,
    };

    await expect(
      rotateVaultKeyWithCrypto(oldKey, { encryptedName, encryptedAccounts: [] }, crypto, signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generatedKey).toBeDefined();
    expect([...generatedKey!].every((byte) => byte === 0)).toBe(true);
    oldKey.fill(0);
  });

  it("clears prepared ciphertext when one account cannot be rotated", async () => {
    const baseCrypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const oldKey = new Uint8Array(32).fill(12);
    const nameContext = { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 } as const;
    const accountContext = {
      purpose: "authenticator-account",
      payloadType: "totp-configuration",
      keyVersion: 1,
    } as const;
    const encryptedName = baseCrypto.serializeEncryptedEnvelope(
      await baseCrypto.encryptPayloadWithContext(oldKey, new TextEncoder().encode("synthetic"), nameContext),
    );
    const firstAccount = baseCrypto.serializeEncryptedEnvelope(
      await baseCrypto.encryptPayloadWithContext(oldKey, new Uint8Array([1]), accountContext),
    );
    const secondAccount = baseCrypto.serializeEncryptedEnvelope(
      await baseCrypto.encryptPayloadWithContext(oldKey, new Uint8Array([2]), accountContext),
    );
    let generatedKey: Uint8Array | undefined;
    let tracking = false;
    let decryptCalls = 0;
    const serializedOutputs: Uint8Array[] = [];
    const crypto: ClientCryptoPort = {
      ...baseCrypto,
      generateSymmetricKey: () => {
        generatedKey = baseCrypto.generateSymmetricKey();
        return generatedKey;
      },
      serializeEncryptedEnvelope: (envelope) => {
        const serialized = baseCrypto.serializeEncryptedEnvelope(envelope);
        if (tracking) serializedOutputs.push(serialized);
        return serialized;
      },
      decryptPayloadWithContext: (key, envelope, context) => {
        decryptCalls += 1;
        if (decryptCalls === 3) throw new Error("synthetic decryption failure");
        return baseCrypto.decryptPayloadWithContext(key, envelope, context);
      },
    };
    tracking = true;

    await expect(
      rotateVaultKeyWithCrypto(oldKey, { encryptedName, encryptedAccounts: [firstAccount, secondAccount] }, crypto),
    ).rejects.toThrow("synthetic decryption failure");
    expect(generatedKey).toBeDefined();
    expect([...generatedKey!].every((byte) => byte === 0)).toBe(true);
    expect(serializedOutputs.length).toBe(2);
    expect(serializedOutputs.every((bytes) => [...bytes].every((byte) => byte === 0))).toBe(true);
    oldKey.fill(0);
  });

  it("strictly parses key-wrap envelopes and key material", async () => {
    const crypto = createClientCryptoPort(new FakeCryptoPrimitives());
    const pair = await crypto.generateUserEncryptionKeyPair();
    const envelope = await crypto.wrapKeyForRecipientWithContext(new Uint8Array(32), pair.publicKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      keyVersion: 1,
    });
    const parsed = JSON.parse(new TextDecoder().decode(crypto.serializeKeyWrapEnvelope(envelope))) as Record<
      string,
      unknown
    >;
    parsed.unexpected = true;
    expect(() => crypto.deserializeKeyWrapEnvelope(new TextEncoder().encode(JSON.stringify(parsed)))).toThrow(
      "invalid",
    );
    await expect(
      crypto.wrapKeyForRecipientWithContext(
        new Uint8Array(32),
        { ...pair.publicKey, x: "AQ" },
        {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          keyVersion: 1,
        },
      ),
    ).rejects.toThrow("ECDH");
    await expect(
      crypto.unwrapKeyForRecipientWithContext(
        envelope,
        { ...pair.privateKey, d: "AQ" },
        {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          keyVersion: 1,
        },
      ),
    ).rejects.toThrow("ECDH");
    await expect(
      crypto.wrapKeyForRecipientWithContext(new Uint8Array(31), pair.publicKey, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        keyVersion: 1,
      }),
    ).rejects.toThrow("32-byte key");
  });
});

class FakeCryptoPrimitives implements CryptoPrimitivePort {
  private counter = 1;

  randomBytes(length: number): Uint8Array {
    return Uint8Array.from({ length }, () => this.counter++ & 0xff);
  }

  async encryptAesGcm(request: {
    key: Uint8Array;
    nonce: Uint8Array;
    plaintext: Uint8Array;
    additionalData?: Uint8Array;
  }): Promise<Uint8Array> {
    const ciphertext = new Uint8Array(request.plaintext.length + 16);
    for (let index = 0; index < request.plaintext.length; index += 1) {
      ciphertext[index] =
        request.plaintext[index] ^
        request.key[index % request.key.length] ^
        request.nonce[index % request.nonce.length];
    }
    ciphertext.fill(
      authTag(request.key, request.nonce, ciphertext.subarray(0, request.plaintext.length), request.additionalData),
      request.plaintext.length,
    );
    return ciphertext;
  }

  async decryptAesGcm(request: {
    key: Uint8Array;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    additionalData?: Uint8Array;
  }): Promise<Uint8Array> {
    if (request.ciphertext.length < 16) throw new Error("Encrypted envelope authentication failed.");
    const encrypted = request.ciphertext.subarray(0, request.ciphertext.length - 16);
    const expected = authTag(request.key, request.nonce, encrypted, request.additionalData);
    if (!request.ciphertext.subarray(encrypted.length).every((value) => value === expected))
      throw new Error("Encrypted envelope authentication failed.");
    return Uint8Array.from(
      encrypted,
      (value, index) => value ^ request.key[index % request.key.length] ^ request.nonce[index % request.nonce.length],
    );
  }

  async generateEcdhKeyPair(): Promise<PortableEcdhKeyPair> {
    const privateBytes = this.randomBytes(32);
    const publicBytes = this.randomBytes(32);
    const publicKey: PortableJsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(privateBytes),
      y: bytesToBase64Url(publicBytes),
    };
    privateBytes.fill(0);
    publicBytes.fill(0);
    return { publicKey, privateKey: { ...publicKey, d: publicKey.x } };
  }

  async deriveEcdhSharedKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): Promise<Uint8Array> {
    const left = base64UrlToBytes(String(privateKey.d));
    const right = base64UrlToBytes(String(publicKey.x));
    const result = Uint8Array.from(left, (value, index) => value ^ right[index]);
    left.fill(0);
    right.fill(0);
    return result;
  }

  async deriveHkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    return Uint8Array.from(
      { length },
      (_, index) =>
        ikm[index % ikm.length] ^
        (salt[index % Math.max(salt.length, 1)] ?? 0) ^
        (info[index % Math.max(info.length, 1)] ?? 0),
    );
  }

  async signHmac(): Promise<Uint8Array> {
    return new Uint8Array(32);
  }
}

function authTag(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, additionalData?: Uint8Array): number {
  let value = 0;
  for (const bytes of [key, nonce, ciphertext, additionalData ?? new Uint8Array()]) {
    for (const byte of bytes) value = (value + byte) & 0xff;
  }
  return value;
}

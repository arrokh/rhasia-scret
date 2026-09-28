import { describe, expect, it, vi } from "vitest";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  createClientCryptoPort,
  createUserEncryptionIdentityWithCrypto,
  migrateLegacySharedVaultKeyWrapWithCrypto,
  EncryptedPayloadMigrationError,
  parseDecryptedAccountPayload,
  recoverUserEncryptionPrivateKeyWithCrypto,
  rotateUserEncryptionIdentityWithCrypto,
  rotateVaultKeyWithCrypto,
  unlockSharedVaultWithCrypto,
  type ClientCryptoPort,
  type CryptoPrimitivePort,
  type PortableEcdhKeyPair,
  type PortableJsonWebKey,
  type Sha256DigestPort,
} from "../src/index";
import {
  migrateLegacyEncryptedPayloadWithCrypto,
  RetryableEncryptedPayloadMigrationCommitError,
  type EncryptedPayloadMigrationStore,
} from "../src/modules/crypto/application/encrypted-payload-migration";
import { migrateUserEncryptionPrivateKeyWithCrypto } from "../src/modules/crypto/application/user-encryption-private-key-migration";

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

  it("migrates a legacy member key wrap with a stable ciphertext-only retry", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const userRootKey = new Uint8Array(32).fill(21);
    const vaultKey = new Uint8Array(32).fill(22);
    const identity = await crypto.generateUserEncryptionKeyPair();
    const legacyEnvelope = await crypto.wrapKeyForRecipient(vaultKey, identity.publicKey);
    const legacyCiphertext = crypto.serializeKeyWrapEnvelope(legacyEnvelope);
    const context = { vaultId: "vault-legacy", recipientId: "user-legacy", keyVersion: 3 } as const;
    const requests: Uint8Array[] = [];
    let attempts = 0;
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async (request) => {
        expect(request).not.toHaveProperty("vaultKey");
        expect(request).not.toHaveProperty("plaintext");
        requests.push(request.replacementCiphertext.slice());
        attempts += 1;
        if (attempts === 1) throw new RetryableEncryptedPayloadMigrationCommitError();
        return "committed";
      },
    };

    const result = await migrateLegacySharedVaultKeyWrapWithCrypto(
      userRootKey,
      legacyCiphertext,
      identity.privateKey,
      identity.publicKey,
      context,
      crypto,
      primitives,
      store,
    );

    expect(result.status).toBe("migrated");
    expect(attempts).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(legacyCiphertext[0]).toBe(0x7b);
    if (result.status !== "migrated") throw new Error("Expected migrated member key-wrap ciphertext.");
    const migratedEnvelope = crypto.deserializeKeyWrapEnvelope(result.encryptedVaultKey);
    expect(migratedEnvelope.version).toBe(2);
    const unwrapped = await crypto.unwrapKeyForRecipientWithContext(migratedEnvelope, identity.privateKey, {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      ...context,
    });
    expect(unwrapped).toEqual(vaultKey);
    unwrapped.fill(0);
    result.encryptedVaultKey.fill(0);
    migratedEnvelope.nonce.fill(0);
    migratedEnvelope.ciphertext.fill(0);
    for (const request of requests) request.fill(0);
    legacyEnvelope.nonce.fill(0);
    legacyEnvelope.ciphertext.fill(0);
    legacyCiphertext.fill(0);
    vaultKey.fill(0);
    userRootKey.fill(0);
    clearJwk(identity.privateKey);
  });

  it("retains the legacy member key-wrap source when its compare-and-swap conflicts", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const userRootKey = new Uint8Array(32).fill(27);
    const vaultKey = new Uint8Array(32).fill(28);
    const identity = await crypto.generateUserEncryptionKeyPair();
    const legacyEnvelope = await crypto.wrapKeyForRecipient(vaultKey, identity.publicKey);
    const legacyCiphertext = crypto.serializeKeyWrapEnvelope(legacyEnvelope);
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async () => "conflict",
    };

    await expect(
      migrateLegacySharedVaultKeyWrapWithCrypto(
        userRootKey,
        legacyCiphertext,
        identity.privateKey,
        identity.publicKey,
        { vaultId: "vault-conflict", recipientId: "user-conflict", keyVersion: 1 },
        crypto,
        primitives,
        store,
      ),
    ).rejects.toMatchObject({ name: EncryptedPayloadMigrationError.name, stage: "persistence-conflict" });
    expect(legacyCiphertext[0]).toBe(0x7b);
    const stillLegacy = crypto.deserializeKeyWrapEnvelope(legacyCiphertext);
    expect(stillLegacy.version).toBe(1);
    stillLegacy.nonce.fill(0);
    stillLegacy.ciphertext.fill(0);
    legacyEnvelope.nonce.fill(0);
    legacyEnvelope.ciphertext.fill(0);
    legacyCiphertext.fill(0);
    vaultKey.fill(0);
    userRootKey.fill(0);
    clearJwk(identity.privateKey);
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
    const account = syntheticAccountPayload();
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
      testVaultKeyRotationPayloadValidator,
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
    const account = syntheticAccountPayload();
    const encryptedName = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(oldKey, name));
    const encryptedAccount = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(oldKey, account));

    const rotated = await rotateVaultKeyWithCrypto(
      oldKey,
      { vaultId, encryptedName, encryptedAccounts: [encryptedAccount] },
      crypto,
      testVaultKeyRotationPayloadValidator,
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
      rotateVaultKeyWithCrypto(
        oldKey,
        { encryptedName, encryptedAccounts: [] },
        crypto,
        testVaultKeyRotationPayloadValidator,
        signal,
      ),
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
      await baseCrypto.encryptPayloadWithContext(oldKey, syntheticAccountPayload(), accountContext),
    );
    const secondAccount = baseCrypto.serializeEncryptedEnvelope(
      await baseCrypto.encryptPayloadWithContext(oldKey, syntheticAccountPayload(), accountContext),
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
      rotateVaultKeyWithCrypto(
        oldKey,
        { encryptedName, encryptedAccounts: [firstAccount, secondAccount] },
        crypto,
        testVaultKeyRotationPayloadValidator,
      ),
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

describe("legacy encrypted payload migration", () => {
  it("migrates and persists a legacy User Encryption Private Key without rotating the identity", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(41);
    const pair = await crypto.generateUserEncryptionKeyPair();
    const originalPublicKey = { ...pair.publicKey };
    const privateKey = { ...pair.privateKey };
    const plaintext = new TextEncoder().encode(JSON.stringify(privateKey));
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    const store = createMemoryMigrationStore(primitives, legacyCiphertext);
    plaintext.fill(0);

    const migratedPrivateKey = await migrateUserEncryptionPrivateKeyWithCrypto(
      rootKey,
      legacyCiphertext,
      pair.publicKey,
      crypto,
      primitives,
      store.store,
    );
    const migratedCiphertext = store.currentCiphertext();
    const originalEnvelope = crypto.deserializeEncryptedEnvelope(legacyCiphertext);
    const migratedEnvelope = crypto.deserializeEncryptedEnvelope(migratedCiphertext);
    const migratedPlaintext = await crypto.decryptPayloadWithContext(rootKey, migratedEnvelope, {
      purpose: "user-encryption-private-key",
      payloadType: "user-encryption-private-key",
      keyVersion: 1,
    });

    expect(migratedPrivateKey).toEqual(privateKey);
    expect(migratedCiphertext[0]).toBe(2);
    expect(migratedEnvelope.nonce).not.toEqual(originalEnvelope.nonce);
    expect(JSON.parse(new TextDecoder().decode(migratedPlaintext))).toEqual(privateKey);
    await expect(
      crypto.decryptPayloadWithContext(rootKey, migratedEnvelope, {
        purpose: "vault-name",
        payloadType: "vault-name",
        keyVersion: 1,
      }),
    ).rejects.toThrow();
    expect(pair.publicKey).toEqual(originalPublicKey);
    clearJwk(migratedPrivateKey);
    clearJwk(privateKey);
    clearJwk(pair.privateKey);
    migratedPlaintext.fill(0);
    originalEnvelope.nonce.fill(0);
    originalEnvelope.ciphertext.fill(0);
    migratedEnvelope.nonce.fill(0);
    migratedEnvelope.ciphertext.fill(0);
    migratedCiphertext.fill(0);
    legacyCiphertext.fill(0);
    rootKey.fill(0);
  });

  it("rejects a private key whose scalar does not match the registered public key", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(29);
    const pair = await crypto.generateUserEncryptionKeyPair();
    const invalidPrivateKey = { ...pair.privateKey, d: bytesToBase64Url(new Uint8Array(32).fill(201)) };
    const plaintext = new TextEncoder().encode(JSON.stringify(invalidPrivateKey));
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    let committed = false;
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async () => {
        committed = true;
        return "committed";
      },
    };

    await expect(
      migrateUserEncryptionPrivateKeyWithCrypto(rootKey, legacyCiphertext, pair.publicKey, crypto, primitives, store),
    ).rejects.toMatchObject({ name: "UserEncryptionPrivateKeyRecoveryError", stage: "payload-invalid" });

    expect(committed).toBe(false);
    expect(legacyCiphertext[0]).toBe(1);
    clearJwk(invalidPrivateKey);
    clearJwk(pair.privateKey);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });

  it("clears private key fields from a malformed parsed legacy payload", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(33);
    const pair = await crypto.generateUserEncryptionKeyPair();
    const plaintext = new TextEncoder().encode("synthetic malformed private key");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    const candidate = {
      kty: "RSA",
      crv: "P-256",
      x: "synthetic-public-x",
      y: "synthetic-public-y",
      d: "synthetic-private-scalar",
    };
    const parse = vi.spyOn(JSON, "parse").mockReturnValue(candidate);
    const commitEncryptedPayloadMigration = vi.fn(async () => "committed" as const);

    try {
      await expect(
        migrateUserEncryptionPrivateKeyWithCrypto(rootKey, legacyCiphertext, pair.publicKey, crypto, primitives, {
          commitEncryptedPayloadMigration,
        }),
      ).rejects.toMatchObject({ name: "UserEncryptionPrivateKeyRecoveryError", stage: "payload-invalid" });
      expect(candidate).toMatchObject({ x: "", y: "", d: "" });
      expect(commitEncryptedPayloadMigration).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
      clearJwk(pair.privateKey);
      legacyCiphertext.fill(0);
      plaintext.fill(0);
      rootKey.fill(0);
    }
  });

  it("reuses the same migration engine for a different synthetic payload context", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(17);
    const context = {
      purpose: "vault-name",
      payloadType: "vault-name",
      profileId: "synthetic-profile",
      keyVersion: 1,
    } as const;
    const plaintext = new TextEncoder().encode("Synthetic Personal Vault");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    const store = createMemoryMigrationStore(primitives, legacyCiphertext);

    const migratedName = await migrateLegacyEncryptedPayloadWithCrypto(
      rootKey,
      legacyCiphertext,
      {
        context,
        validatePlaintext: (value) => {
          const name = new TextDecoder("utf-8", { fatal: true }).decode(value);
          if (name !== "Synthetic Personal Vault") throw new Error("Synthetic Vault Name is invalid.");
          return name;
        },
        clearValidatedPayload: () => undefined,
      },
      crypto,
      primitives,
      store.store,
    );
    const migratedCiphertext = store.currentCiphertext();
    const migratedEnvelope = crypto.deserializeEncryptedEnvelope(migratedCiphertext);

    expect(migratedName).toBe("Synthetic Personal Vault");
    expect(migratedEnvelope.version).toBe(2);
    await expect(crypto.decryptPayloadWithContext(rootKey, migratedEnvelope, context)).resolves.toEqual(plaintext);
    migratedEnvelope.nonce.fill(0);
    migratedEnvelope.ciphertext.fill(0);
    migratedCiphertext.fill(0);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });

  it("retries a transient lost response with the identical prepared ciphertext", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(29);
    const plaintext = new TextEncoder().encode("Synthetic retry payload");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    const memory = createMemoryMigrationStore(primitives, legacyCiphertext);
    const operationIds: string[] = [];
    const replacements: Uint8Array[] = [];
    let attempts = 0;
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async (request) => {
        attempts += 1;
        operationIds.push(request.operationId);
        replacements.push(request.replacementCiphertext.slice());
        const result = await memory.store.commitEncryptedPayloadMigration(request);
        if (attempts === 1) throw new RetryableEncryptedPayloadMigrationCommitError();
        return result;
      },
    };

    await expect(
      migrateLegacyEncryptedPayloadWithCrypto(
        rootKey,
        legacyCiphertext,
        {
          context: { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 },
          validatePlaintext: (value) => new TextDecoder().decode(value),
          clearValidatedPayload: () => undefined,
        },
        crypto,
        primitives,
        store,
      ),
    ).resolves.toBe("Synthetic retry payload");

    expect(attempts).toBe(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(replacements[0]).toEqual(replacements[1]);
    const migratedCiphertext = memory.currentCiphertext();
    expect(migratedCiphertext).toEqual(replacements[0]);
    expect(migratedCiphertext[0]).toBe(2);

    for (const replacement of replacements) replacement.fill(0);
    migratedCiphertext.fill(0);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });

  it("retains legacy ciphertext when the single transient retry also fails", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(37);
    const plaintext = new TextEncoder().encode("Synthetic retry failure");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    let attempts = 0;
    let cleared = false;
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async () => {
        attempts += 1;
        throw new RetryableEncryptedPayloadMigrationCommitError();
      },
    };

    await expect(
      migrateLegacyEncryptedPayloadWithCrypto(
        rootKey,
        legacyCiphertext,
        {
          context: { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 },
          validatePlaintext: (value) => new TextDecoder().decode(value),
          clearValidatedPayload: () => {
            cleared = true;
          },
        },
        crypto,
        primitives,
        store,
      ),
    ).rejects.toMatchObject({ name: "EncryptedPayloadMigrationError", stage: "persistence-failed" });

    expect(attempts).toBe(2);
    expect(cleared).toBe(true);
    expect(legacyCiphertext[0]).toBe(1);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });

  it("does not retry a definitive commit failure and retains legacy ciphertext", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(41);
    const plaintext = new TextEncoder().encode("Synthetic permanent failure");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    let attempts = 0;
    let cleared = false;
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async () => {
        attempts += 1;
        throw new Error("synthetic permanent failure");
      },
    };

    await expect(
      migrateLegacyEncryptedPayloadWithCrypto(
        rootKey,
        legacyCiphertext,
        {
          context: { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 },
          validatePlaintext: (value) => new TextDecoder().decode(value),
          clearValidatedPayload: () => {
            cleared = true;
          },
        },
        crypto,
        primitives,
        store,
      ),
    ).rejects.toMatchObject({ name: "EncryptedPayloadMigrationError", stage: "persistence-failed" });

    expect(attempts).toBe(1);
    expect(cleared).toBe(true);
    expect(legacyCiphertext[0]).toBe(1);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });

  it("clears validated data and retains legacy ciphertext when persistence is interrupted", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(31);
    const plaintext = new TextEncoder().encode("Synthetic interrupted payload");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    const memory = createMemoryMigrationStore(primitives, legacyCiphertext);
    let cleared = false;
    const interruptedStore: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async () => {
        throw new DOMException("interrupted", "AbortError");
      },
    };

    await expect(
      migrateLegacyEncryptedPayloadWithCrypto(
        rootKey,
        legacyCiphertext,
        {
          context: { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 },
          validatePlaintext: (value) => new TextDecoder().decode(value),
          clearValidatedPayload: () => {
            cleared = true;
          },
        },
        crypto,
        primitives,
        interruptedStore,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    const currentCiphertext = memory.currentCiphertext();
    expect(cleared).toBe(true);
    expect(currentCiphertext[0]).toBe(1);
    currentCiphertext.fill(0);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });

  it("clears validated private data and retains legacy ciphertext when compare-and-swap conflicts", async () => {
    const primitives = new FakeCryptoPrimitives();
    const crypto = createClientCryptoPort(primitives);
    const rootKey = new Uint8Array(32).fill(23);
    const plaintext = new TextEncoder().encode("Synthetic legacy payload");
    const legacyCiphertext = crypto.serializeEncryptedEnvelope(await crypto.encryptPayload(rootKey, plaintext));
    let cleared = false;
    const store: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async () => "conflict",
    };

    await expect(
      migrateLegacyEncryptedPayloadWithCrypto(
        rootKey,
        legacyCiphertext,
        {
          context: { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 },
          validatePlaintext: (value) => new TextDecoder().decode(value),
          clearValidatedPayload: () => {
            cleared = true;
          },
        },
        crypto,
        primitives,
        store,
      ),
    ).rejects.toMatchObject({ name: "EncryptedPayloadMigrationError", stage: "persistence-conflict" });

    expect(cleared).toBe(true);
    expect(legacyCiphertext[0]).toBe(1);
    legacyCiphertext.fill(0);
    plaintext.fill(0);
    rootKey.fill(0);
  });
});

const testVaultKeyRotationPayloadValidator = {
  validateVaultName(plaintext: Uint8Array): void {
    const name = new TextDecoder("utf-8", { fatal: true }).decode(plaintext).trim();
    if (!name || name.length > 120) throw new Error("Vault name is invalid.");
  },
  validateAuthenticatorAccount(plaintext: Uint8Array): void {
    const account = parseDecryptedAccountPayload(plaintext);
    account.secret.fill(0);
  },
};

function createMemoryMigrationStore(digest: Sha256DigestPort, originalCiphertext: Uint8Array) {
  let currentCiphertext = originalCiphertext.slice();
  const store: EncryptedPayloadMigrationStore = {
    commitEncryptedPayloadMigration: async (request) => {
      const currentDigest = await digest.digestSha256(currentCiphertext);
      const currentDigestBase64 = bytesToBase64Url(currentDigest);
      currentDigest.fill(0);
      if (request.operationId !== request.replacementCiphertextDigest) return "conflict";
      if (equalBytes(currentCiphertext, request.replacementCiphertext)) return "already-committed";
      if (
        currentCiphertext[0] !== request.expectedEnvelopeVersion ||
        currentDigestBase64 !== request.expectedCiphertextDigest
      )
        return "conflict";
      currentCiphertext.fill(0);
      currentCiphertext = request.replacementCiphertext.slice();
      return "committed";
    },
  };
  return { store, currentCiphertext: () => currentCiphertext.slice() };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clearJwk(privateKey: PortableJsonWebKey): void {
  Reflect.set(privateKey, "x", "");
  Reflect.set(privateKey, "y", "");
  Reflect.set(privateKey, "d", "");
}

function syntheticAccountPayload(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      issuer: "Example Issuer",
      accountName: "demo@example.invalid",
      secret: "AQID",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    }),
  );
}

class FakeCryptoPrimitives implements CryptoPrimitivePort {
  private counter = 1;

  randomBytes(length: number): Uint8Array {
    return Uint8Array.from({ length }, () => this.counter++ & 0xff);
  }

  async digestSha256(message: Uint8Array): Promise<Uint8Array> {
    const digest = new Uint8Array(32);
    for (let index = 0; index < message.length; index += 1) {
      const slot = index % digest.length;
      digest[slot] = (digest[slot] + message[index] + index) & 0xff;
    }
    return digest;
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

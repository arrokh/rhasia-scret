import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  clearUnlockedVaultWorkspace,
  createAuthenticatorAccountPayloadPort,
  createUserEncryptionIdentityWithCrypto,
  migrateLegacySharedVaultKeyWrapWithCrypto,
  loadOfflineVaultWorkspace,
  loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey,
  unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey,
  unwrapSharedVaultKeyWithCrypto,
  type AuthorizedWorkspaceResponse,
  type EncryptedPersonalOfflineSnapshot,
  type PortableJsonWebKey,
  type VaultWorkspacePlatformPorts,
} from "@rhasia-scret/client-vault-core";
import type {
  EncryptedPayloadMigrationCommit,
  EncryptedPayloadMigrationStore,
} from "@rhasia-scret/client-vault-core/modules/crypto/application/encrypted-payload-migration";
import { migrateUserEncryptionPrivateKeyWithCrypto } from "@rhasia-scret/client-vault-core/modules/crypto/application/user-encryption-private-key-migration";
import { recoverUserEncryptionPrivateKeyWithCrypto } from "@rhasia-scret/client-vault-core";
import { browserClientCryptoPort } from "@/modules/crypto/infrastructure/browser-client-crypto-port";
import { browserSha256Digest } from "@/modules/crypto/infrastructure/browser-sha256-digest";

describe("retrieved legacy User Encryption Private Key workspace journey", () => {
  it("commits retrieved v1 identity ciphertext, then unlocks a Shared Vault from the committed v2 identity", async () => {
    const rootKey = new Uint8Array(32).fill(41);
    const personalVaultKey = new Uint8Array(32).fill(42);
    const unlockKey = new Uint8Array(32).fill(43);
    const sharedVaultKey = new Uint8Array(32).fill(44);
    const vaultUnlockSalt = new Uint8Array(16).fill(45);
    const accountSecret = Uint8Array.from({ length: 20 }, (_, index) => index + 1);
    const accountConfiguration = {
      issuer: "Example Issuer",
      accountName: "sample@example.invalid",
      secret: accountSecret,
      algorithm: "SHA-1" as const,
      digits: 6 as const,
      period: 30,
    };
    const identity = await browserClientCryptoPort.generateUserEncryptionKeyPair();
    const legacyPrivateKeyPlaintext = new TextEncoder().encode(JSON.stringify(identity.privateKey));
    const legacyPrivateKeyEnvelope = await browserClientCryptoPort.encryptPayload(rootKey, legacyPrivateKeyPlaintext);
    const legacyPrivateKeyCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPrivateKeyEnvelope);
    const legacyEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(legacyPrivateKeyCiphertext);

    const accountPayload = createAuthenticatorAccountPayloadPort(browserClientCryptoPort);
    const accountPayloadPlaintext = accountPayload.serializeDecryptedAccountPayload(accountConfiguration);
    const legacyAccountEnvelope = await browserClientCryptoPort.encryptPayload(sharedVaultKey, accountPayloadPlaintext);
    const encryptedAccount = browserClientCryptoPort.serializeEncryptedEnvelope(legacyAccountEnvelope);
    const legacyPersonalAccountEnvelope = await browserClientCryptoPort.encryptPayload(
      personalVaultKey,
      accountPayloadPlaintext,
    );
    const encryptedPersonalAccount = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPersonalAccountEnvelope);
    accountPayloadPlaintext.fill(0);
    accountSecret.fill(0);

    const legacySharedNamePlaintext = new TextEncoder().encode("Shared Synthetic Vault");
    const legacySharedNameEnvelope = await browserClientCryptoPort.encryptPayload(
      sharedVaultKey,
      legacySharedNamePlaintext,
    );
    const encryptedSharedName = browserClientCryptoPort.serializeEncryptedEnvelope(legacySharedNameEnvelope);
    legacySharedNamePlaintext.fill(0);
    const encryptedSharedKey = await browserClientCryptoPort.wrapKeyForRecipient(sharedVaultKey, identity.publicKey);
    const serializedSharedKey = browserClientCryptoPort.serializeKeyWrapEnvelope(encryptedSharedKey);
    const wrappedRootKey = await encryptWithContext(unlockKey, rootKey, {
      purpose: "user-root-key-wrap",
      payloadType: "user-root-key",
      keyVersion: 1,
    });
    const legacyPersonalKeyEnvelope = await browserClientCryptoPort.encryptPayload(rootKey, personalVaultKey);
    const wrappedPersonalVaultKey = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPersonalKeyEnvelope);
    const legacyPersonalNamePlaintext = new TextEncoder().encode("Personal Synthetic Vault");
    const legacyPersonalNameEnvelope = await browserClientCryptoPort.encryptPayload(
      personalVaultKey,
      legacyPersonalNamePlaintext,
    );
    const encryptedPersonalName = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPersonalNameEnvelope);
    legacyPersonalNamePlaintext.fill(0);

    const response = createWorkspaceResponse({
      encryptedPrivateKey: bytesToBase64(legacyPrivateKeyCiphertext),
      encryptedPersonalName: bytesToBase64(encryptedPersonalName),
      encryptedSharedName: bytesToBase64(encryptedSharedName),
      encryptedSharedKey: bytesToBase64(serializedSharedKey),
      encryptedSharedAccount: bytesToBase64(encryptedAccount),
      vaultUnlockSalt: bytesToBase64(vaultUnlockSalt),
      wrappedRootKey: bytesToBase64(wrappedRootKey),
      wrappedPersonalVaultKey: bytesToBase64(wrappedPersonalVaultKey),
      publicKey: identity.publicKey,
    });
    response.personalSnapshot.personalVault.accounts = [
      {
        id: "personal-synthetic-account",
        encryptedPayload: bytesToBase64(encryptedPersonalAccount),
        encryptionVersion: 1,
        revision: 1,
      },
    ];

    let commitCount = 0;
    let profileCommitCount = 0;
    let sharedKeyWrapCommitCount = 0;
    const migrationStore: EncryptedPayloadMigrationStore = {
      commitEncryptedPayloadMigration: async (request: EncryptedPayloadMigrationCommit) => {
        expect(request).not.toHaveProperty("plaintext");
        expect(request).not.toHaveProperty("privateKey");
        const userEncryptionIdentity = requireUserEncryptionIdentity(response);
        const current = base64ToBytes(userEncryptionIdentity.encryptedPrivateKey);
        let currentDigest: Uint8Array | undefined;
        let replacementDigest: Uint8Array | undefined;
        try {
          currentDigest = await browserSha256Digest.digestSha256(current);
          replacementDigest = await browserSha256Digest.digestSha256(request.replacementCiphertext);
          const currentFingerprint = bytesToBase64Url(currentDigest);
          const replacementFingerprint = bytesToBase64Url(replacementDigest);
          if (currentFingerprint === request.replacementCiphertextDigest && request.operationId === currentFingerprint)
            return "already-committed";
          if (
            current[0] !== request.expectedEnvelopeVersion ||
            currentFingerprint !== request.expectedCiphertextDigest ||
            request.replacementEnvelopeVersion !== 2 ||
            request.replacementCiphertext[0] !== 2 ||
            replacementFingerprint !== request.replacementCiphertextDigest ||
            request.operationId !== replacementFingerprint
          )
            return "conflict";

          userEncryptionIdentity.encryptedPrivateKey = bytesToBase64(request.replacementCiphertext);
          commitCount += 1;
          return "committed";
        } finally {
          current.fill(0);
          currentDigest?.fill(0);
          replacementDigest?.fill(0);
        }
      },
    };

    let fetchCount = 0;
    const persistedSnapshots: AuthorizedWorkspaceResponse["personalSnapshot"][] = [];
    const ports = createWorkspacePorts({
      response,
      rootKey,
      unlockKey,
      persistedSnapshots,
      fetchCount: () => {
        fetchCount += 1;
      },
      profileCommitCount: () => {
        profileCommitCount += 1;
      },
      sharedKeyWrapCommitCount: () => {
        sharedKeyWrapCommitCount += 1;
      },
      migrationStore,
    });

    try {
      const firstWorkspace = await loadUnlockedVaultWorkspaceWithPasskey("personal-synthetic-vault", ports);
      expect(firstWorkspace.vaults.map(({ name }) => name)).toEqual([
        "Personal Synthetic Vault",
        "Shared Synthetic Vault",
      ]);
      expect(firstWorkspace.accounts).toHaveLength(2);
      expect(firstWorkspace.accounts[0]).toMatchObject({
        issuer: "Example Issuer",
        accountName: "sample@example.invalid",
        vaultId: "personal-synthetic-vault",
        vaultType: "PERSONAL",
      });
      expect(firstWorkspace.accounts[1]).toMatchObject({
        issuer: "Example Issuer",
        accountName: "sample@example.invalid",
        vaultId: "shared-synthetic-vault",
        vaultType: "SHARED",
      });
      expect([...firstWorkspace.accounts[0]!.secret]).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
      expect([...firstWorkspace.accounts[1]!.secret]).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
      expect(commitCount).toBe(1);
      expect(profileCommitCount).toBe(1);
      expect(sharedKeyWrapCommitCount).toBe(1);
      expect(base64ToBytes(response.personalSnapshot.personalVault.encryptedName)[0]).toBe(2);
      expect(base64ToBytes(response.sharedVaults[0]!.encryptedName)[0]).toBe(2);
      const migratedProfileCiphertext = base64ToBytes(
        response.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey,
      );
      const migratedProfileEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(migratedProfileCiphertext);
      expect(migratedProfileEnvelope.version).toBe(2);
      expect(migratedProfileEnvelope.nonce).not.toEqual(legacyPersonalKeyEnvelope.nonce);
      migratedProfileEnvelope.nonce.fill(0);
      migratedProfileEnvelope.ciphertext.fill(0);
      migratedProfileCiphertext.fill(0);
      const migratedCiphertext = base64ToBytes(requireUserEncryptionIdentity(response).encryptedPrivateKey);
      expect(migratedCiphertext[0]).toBe(2);
      migratedCiphertext.fill(0);
      const migratedSharedKeyCiphertext = base64ToBytes(response.sharedVaults[0]!.encryptedVaultKey);
      const migratedSharedKey = browserClientCryptoPort.deserializeKeyWrapEnvelope(migratedSharedKeyCiphertext);
      expect(migratedSharedKey.version).toBe(2);
      expect(migratedSharedKey.nonce).not.toEqual(encryptedSharedKey.nonce);
      migratedSharedKey.nonce.fill(0);
      migratedSharedKey.ciphertext.fill(0);
      migratedSharedKeyCiphertext.fill(0);
      const migratedAccountCiphertext = base64ToBytes(response.sharedVaults[0]!.accounts[0]!.encryptedPayload);
      const migratedAccountEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(migratedAccountCiphertext);
      expect(migratedAccountEnvelope.version).toBe(2);
      expect(migratedAccountEnvelope.nonce).not.toEqual(legacyAccountEnvelope.nonce);
      migratedAccountEnvelope.nonce.fill(0);
      migratedAccountEnvelope.ciphertext.fill(0);
      migratedAccountCiphertext.fill(0);
      const migratedPersonalAccountCiphertext = base64ToBytes(
        response.personalSnapshot.personalVault.accounts[0]!.encryptedPayload,
      );
      const migratedPersonalAccountEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(
        migratedPersonalAccountCiphertext,
      );
      expect(migratedPersonalAccountEnvelope.version).toBe(2);
      expect(migratedPersonalAccountEnvelope.nonce).not.toEqual(legacyPersonalAccountEnvelope.nonce);
      migratedPersonalAccountEnvelope.nonce.fill(0);
      migratedPersonalAccountEnvelope.ciphertext.fill(0);
      migratedPersonalAccountCiphertext.fill(0);
      expect(persistedSnapshots).toHaveLength(1);
      expect(persistedSnapshots[0]).not.toHaveProperty("userEncryptionIdentity");
      clearUnlockedVaultWorkspace(firstWorkspace);

      const committedCiphertext = base64ToBytes(requireUserEncryptionIdentity(response).encryptedPrivateKey);
      const committedEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(committedCiphertext);
      expect(committedEnvelope.version).toBe(2);
      expect(committedEnvelope.nonce).not.toEqual(legacyEnvelope.nonce);
      committedEnvelope.nonce.fill(0);
      committedEnvelope.ciphertext.fill(0);
      committedCiphertext.fill(0);

      const secondWorkspace = await loadUnlockedVaultWorkspaceWithPasskey("personal-synthetic-vault", ports);
      expect(secondWorkspace.vaults.map(({ name }) => name)).toEqual([
        "Personal Synthetic Vault",
        "Shared Synthetic Vault",
      ]);
      expect(secondWorkspace.accounts).toHaveLength(2);
      expect(commitCount).toBe(1);
      expect(profileCommitCount).toBe(1);
      expect(sharedKeyWrapCommitCount).toBe(1);
      expect(fetchCount).toBe(2);
      clearUnlockedVaultWorkspace(secondWorkspace);
    } finally {
      rootKey.fill(0);
      personalVaultKey.fill(0);
      unlockKey.fill(0);
      sharedVaultKey.fill(0);
      vaultUnlockSalt.fill(0);
      accountSecret.fill(0);
      legacyPrivateKeyPlaintext.fill(0);
      legacyPrivateKeyEnvelope.nonce.fill(0);
      legacyPrivateKeyEnvelope.ciphertext.fill(0);
      legacyPrivateKeyCiphertext.fill(0);
      legacyEnvelope.nonce.fill(0);
      legacyEnvelope.ciphertext.fill(0);
      encryptedAccount.fill(0);
      encryptedPersonalAccount.fill(0);
      legacyPersonalAccountEnvelope.nonce.fill(0);
      legacyPersonalAccountEnvelope.ciphertext.fill(0);
      legacyAccountEnvelope.nonce.fill(0);
      legacyAccountEnvelope.ciphertext.fill(0);
      encryptedSharedName.fill(0);
      legacySharedNameEnvelope.nonce.fill(0);
      legacySharedNameEnvelope.ciphertext.fill(0);
      legacyPersonalNameEnvelope.nonce.fill(0);
      legacyPersonalNameEnvelope.ciphertext.fill(0);
      encryptedSharedKey.nonce.fill(0);
      encryptedSharedKey.ciphertext.fill(0);
      serializedSharedKey.fill(0);
      wrappedRootKey.fill(0);
      wrappedPersonalVaultKey.fill(0);
      legacyPersonalKeyEnvelope.nonce.fill(0);
      legacyPersonalKeyEnvelope.ciphertext.fill(0);
      encryptedPersonalName.fill(0);
      clearPrivateKey(identity.privateKey);
    }
  });

  it("commits both legacy Personal Vault profile wrappers before unlocking with the v2 profile", async () => {
    const rootKey = new Uint8Array(32).fill(51);
    const personalVaultKey = new Uint8Array(32).fill(52);
    const unlockKey = new Uint8Array(32).fill(53);
    const salt = new Uint8Array(16).fill(54);
    const identity = await browserClientCryptoPort.generateUserEncryptionKeyPair();
    const legacyRootEnvelope = await browserClientCryptoPort.encryptPayload(unlockKey, rootKey);
    const legacyRootCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyRootEnvelope);
    const legacyPersonalKeyEnvelope = await browserClientCryptoPort.encryptPayload(rootKey, personalVaultKey);
    const legacyPersonalKeyCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPersonalKeyEnvelope);
    const personalName = await encryptWithContext(personalVaultKey, "Personal Synthetic Vault", {
      purpose: "vault-name",
      payloadType: "vault-name",
      keyVersion: 1,
    });
    const response = createWorkspaceResponse({
      encryptedPrivateKey: "Ag==",
      encryptedPersonalName: bytesToBase64(personalName),
      encryptedSharedName: "Ag==",
      encryptedSharedKey: "Ag==",
      encryptedSharedAccount: "Ag==",
      vaultUnlockSalt: bytesToBase64(salt),
      wrappedRootKey: bytesToBase64(legacyRootCiphertext),
      wrappedPersonalVaultKey: bytesToBase64(legacyPersonalKeyCiphertext),
      publicKey: identity.publicKey,
    });
    response.sharedVaults = [];
    let profileCommitCount = 0;
    const persistedSnapshots: AuthorizedWorkspaceResponse["personalSnapshot"][] = [];
    const ports = createWorkspacePorts({
      response,
      rootKey,
      unlockKey,
      persistedSnapshots,
      fetchCount: () => undefined,
      profileCommitCount: () => {
        profileCommitCount += 1;
      },
      migrationStore: { commitEncryptedPayloadMigration: async () => "conflict" },
    });

    let workspace: Awaited<ReturnType<typeof loadUnlockedVaultWorkspace>> | undefined;
    let subsequentWorkspace: Awaited<ReturnType<typeof loadUnlockedVaultWorkspace>> | undefined;
    try {
      const oldWrappedRootKey = response.personalSnapshot.cryptoProfile.wrappedUserRootKey;
      const oldPersonalKey = response.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey;
      await expect(
        loadUnlockedVaultWorkspace("synthetic wrong passphrase", "personal-synthetic-vault", ports),
      ).rejects.toMatchObject({ name: "PersonalVaultUnlockError", stage: "user-root-key" });
      expect(response.personalSnapshot.cryptoProfile.wrappedUserRootKey).toBe(oldWrappedRootKey);
      expect(response.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey).toBe(oldPersonalKey);

      workspace = await loadUnlockedVaultWorkspace("synthetic passphrase", "personal-synthetic-vault", ports);
      expect(workspace.vaults.map(({ name }) => name)).toEqual(["Personal Synthetic Vault"]);
      expect(profileCommitCount).toBe(1);
      expect(persistedSnapshots).toHaveLength(1);
      const migratedRootCiphertext = base64ToBytes(response.personalSnapshot.cryptoProfile.wrappedUserRootKey);
      const migratedRootEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(migratedRootCiphertext);
      const migratedPersonalKeyCiphertext = base64ToBytes(
        response.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey,
      );
      const migratedPersonalKeyEnvelope =
        browserClientCryptoPort.deserializeEncryptedEnvelope(migratedPersonalKeyCiphertext);
      try {
        expect(migratedRootEnvelope.version).toBe(2);
        expect(migratedPersonalKeyEnvelope.version).toBe(2);
        expect(migratedRootEnvelope.nonce).not.toEqual(legacyRootEnvelope.nonce);
        expect(migratedPersonalKeyEnvelope.nonce).not.toEqual(legacyPersonalKeyEnvelope.nonce);
        expect(persistedSnapshots[0]?.cryptoProfile.wrappedUserRootKey).toBe(
          response.personalSnapshot.cryptoProfile.wrappedUserRootKey,
        );
        expect(persistedSnapshots[0]?.cryptoProfile.encryptedPersonalVaultKey).toBe(
          response.personalSnapshot.cryptoProfile.encryptedPersonalVaultKey,
        );
      } finally {
        migratedRootEnvelope.nonce.fill(0);
        migratedRootEnvelope.ciphertext.fill(0);
        migratedRootCiphertext.fill(0);
        migratedPersonalKeyEnvelope.nonce.fill(0);
        migratedPersonalKeyEnvelope.ciphertext.fill(0);
        migratedPersonalKeyCiphertext.fill(0);
      }
      clearUnlockedVaultWorkspace(workspace);
      workspace = undefined;

      subsequentWorkspace = await loadUnlockedVaultWorkspace("synthetic passphrase", "personal-synthetic-vault", ports);
      expect(subsequentWorkspace.vaults.map(({ name }) => name)).toEqual(["Personal Synthetic Vault"]);
      expect(profileCommitCount).toBe(1);
      clearUnlockedVaultWorkspace(subsequentWorkspace);
      subsequentWorkspace = undefined;
    } finally {
      if (workspace) clearUnlockedVaultWorkspace(workspace);
      if (subsequentWorkspace) clearUnlockedVaultWorkspace(subsequentWorkspace);
      rootKey.fill(0);
      personalVaultKey.fill(0);
      unlockKey.fill(0);
      salt.fill(0);
      legacyRootEnvelope.nonce.fill(0);
      legacyRootEnvelope.ciphertext.fill(0);
      legacyRootCiphertext.fill(0);
      legacyPersonalKeyEnvelope.nonce.fill(0);
      legacyPersonalKeyEnvelope.ciphertext.fill(0);
      legacyPersonalKeyCiphertext.fill(0);
      personalName.fill(0);
      clearPrivateKey(identity.privateKey);
    }
  });

  it("migrates legacy profile wrappers, name, and accounts in an offline snapshot", async () => {
    const rootKey = new Uint8Array(32).fill(61);
    const personalVaultKey = new Uint8Array(32).fill(62);
    const unlockKey = new Uint8Array(32).fill(63);
    const salt = new Uint8Array(16).fill(64);
    const identity = await browserClientCryptoPort.generateUserEncryptionKeyPair();
    const legacyRootEnvelope = await browserClientCryptoPort.encryptPayload(unlockKey, rootKey);
    const legacyRootCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyRootEnvelope);
    const legacyPersonalKeyEnvelope = await browserClientCryptoPort.encryptPayload(rootKey, personalVaultKey);
    const legacyPersonalKeyCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPersonalKeyEnvelope);
    const legacyPersonalNamePlaintext = new TextEncoder().encode("Personal Synthetic Vault");
    const legacyPersonalNameEnvelope = await browserClientCryptoPort.encryptPayload(
      personalVaultKey,
      legacyPersonalNamePlaintext,
    );
    const legacyPersonalNameCiphertext = browserClientCryptoPort.serializeEncryptedEnvelope(legacyPersonalNameEnvelope);
    legacyPersonalNamePlaintext.fill(0);
    const offlineAccountSecret = new Uint8Array(20).fill(65);
    const offlineAccountPayload = createAuthenticatorAccountPayloadPort(browserClientCryptoPort);
    const offlineAccountPlaintext = offlineAccountPayload.serializeDecryptedAccountPayload({
      issuer: "Offline Example",
      accountName: "offline@example.invalid",
      secret: offlineAccountSecret,
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    });
    const legacyOfflineAccountEnvelope = await browserClientCryptoPort.encryptPayload(
      personalVaultKey,
      offlineAccountPlaintext,
    );
    const legacyOfflineAccountCiphertext =
      browserClientCryptoPort.serializeEncryptedEnvelope(legacyOfflineAccountEnvelope);
    offlineAccountSecret.fill(0);
    offlineAccountPlaintext.fill(0);
    const response = createWorkspaceResponse({
      encryptedPrivateKey: "Ag==",
      encryptedPersonalName: bytesToBase64(legacyPersonalNameCiphertext),
      encryptedSharedName: "Ag==",
      encryptedSharedKey: "Ag==",
      encryptedSharedAccount: "Ag==",
      vaultUnlockSalt: bytesToBase64(salt),
      wrappedRootKey: bytesToBase64(legacyRootCiphertext),
      wrappedPersonalVaultKey: bytesToBase64(legacyPersonalKeyCiphertext),
      publicKey: identity.publicKey,
    });
    response.sharedVaults = [];
    response.personalSnapshot.personalVault.accounts = [
      {
        id: "offline-synthetic-account",
        encryptedPayload: bytesToBase64(legacyOfflineAccountCiphertext),
        encryptionVersion: 1,
        revision: 1,
      },
    ];
    let currentSnapshot: EncryptedPersonalOfflineSnapshot = response.personalSnapshot;
    let replacements = 0;
    const basePorts = createWorkspacePorts({
      response,
      rootKey,
      unlockKey,
      persistedSnapshots: [],
      fetchCount: () => undefined,
      profileCommitCount: () => {
        throw new Error("Offline migration must not call the hosted profile endpoint.");
      },
      migrationStore: { commitEncryptedPayloadMigration: async () => "conflict" },
    });
    const ports: VaultWorkspacePlatformPorts = {
      ...basePorts,
      network: { isOnline: () => false, subscribe: () => () => undefined },
      data: {
        ...basePorts.data,
        snapshotStore: {
          listProfiles: async () => ({ profiles: [], migrationRequired: false }),
          read: async () => currentSnapshot,
          readByPersonalVaultId: async () => null,
          replace: async (snapshot) => {
            currentSnapshot = snapshot;
            replacements += 1;
          },
          removeVault: async () => undefined,
          removeProfile: async () => undefined,
          clearAll: async () => undefined,
        },
      },
    };

    let workspace: Awaited<ReturnType<typeof loadOfflineVaultWorkspace>> | undefined;
    let subsequentWorkspace: Awaited<ReturnType<typeof loadOfflineVaultWorkspace>> | undefined;
    try {
      await expect(
        loadOfflineVaultWorkspace("synthetic-profile", "synthetic wrong passphrase", ports),
      ).rejects.toMatchObject({ name: "PersonalVaultUnlockError", stage: "user-root-key" });
      expect(replacements).toBe(0);
      expect(currentSnapshot.cryptoProfile.wrappedUserRootKey).toBe(bytesToBase64(legacyRootCiphertext));
      expect(currentSnapshot.cryptoProfile.encryptedPersonalVaultKey).toBe(bytesToBase64(legacyPersonalKeyCiphertext));
      expect(currentSnapshot.personalVault.encryptedName).toBe(bytesToBase64(legacyPersonalNameCiphertext));
      expect(currentSnapshot.personalVault.accounts[0]?.encryptedPayload).toBe(
        bytesToBase64(legacyOfflineAccountCiphertext),
      );

      workspace = await loadOfflineVaultWorkspace("synthetic-profile", "synthetic passphrase", ports);
      expect(workspace.syncState).toBe("OFFLINE");
      expect(workspace.vaults.map(({ name }) => name)).toEqual(["Personal Synthetic Vault"]);
      expect(workspace.accounts).toHaveLength(1);
      expect(workspace.accounts[0]).toMatchObject({
        issuer: "Offline Example",
        accountName: "offline@example.invalid",
      });
      expect(replacements).toBe(3);
      const migratedRootBytes = base64ToBytes(currentSnapshot.cryptoProfile.wrappedUserRootKey);
      const migratedPersonalKeyBytes = base64ToBytes(currentSnapshot.cryptoProfile.encryptedPersonalVaultKey);
      const migratedRootEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(migratedRootBytes);
      const migratedPersonalKeyEnvelope =
        browserClientCryptoPort.deserializeEncryptedEnvelope(migratedPersonalKeyBytes);
      try {
        expect(migratedRootEnvelope.version).toBe(2);
        expect(migratedRootEnvelope.nonce).not.toEqual(legacyRootEnvelope.nonce);
        expect(migratedPersonalKeyEnvelope.version).toBe(2);
        expect(migratedPersonalKeyEnvelope.nonce).not.toEqual(legacyPersonalKeyEnvelope.nonce);
      } finally {
        migratedRootBytes.fill(0);
        migratedPersonalKeyBytes.fill(0);
        migratedRootEnvelope.nonce.fill(0);
        migratedRootEnvelope.ciphertext.fill(0);
        migratedPersonalKeyEnvelope.nonce.fill(0);
        migratedPersonalKeyEnvelope.ciphertext.fill(0);
      }
      const migratedNameBytes = base64ToBytes(currentSnapshot.personalVault.encryptedName);
      const migratedNameEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(migratedNameBytes);
      const migratedAccountBytes = base64ToBytes(currentSnapshot.personalVault.accounts[0]!.encryptedPayload);
      const migratedAccountEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(migratedAccountBytes);
      try {
        expect(migratedNameEnvelope.version).toBe(2);
        expect(migratedNameEnvelope.nonce).not.toEqual(legacyPersonalNameEnvelope.nonce);
        expect(migratedAccountEnvelope.version).toBe(2);
        expect(migratedAccountEnvelope.nonce).not.toEqual(legacyOfflineAccountEnvelope.nonce);
        expect(currentSnapshot.personalVault.accounts[0]).toMatchObject({
          id: "offline-synthetic-account",
          encryptionVersion: 1,
          revision: 1,
        });
      } finally {
        migratedNameBytes.fill(0);
        migratedNameEnvelope.nonce.fill(0);
        migratedNameEnvelope.ciphertext.fill(0);
        migratedAccountBytes.fill(0);
        migratedAccountEnvelope.nonce.fill(0);
        migratedAccountEnvelope.ciphertext.fill(0);
      }
      clearUnlockedVaultWorkspace(workspace);
      workspace = undefined;

      subsequentWorkspace = await loadOfflineVaultWorkspace("synthetic-profile", "synthetic passphrase", ports);
      expect(subsequentWorkspace.vaults.map(({ name }) => name)).toEqual(["Personal Synthetic Vault"]);
      expect(subsequentWorkspace.accounts).toHaveLength(1);
      expect(replacements).toBe(3);
      clearUnlockedVaultWorkspace(subsequentWorkspace);
      subsequentWorkspace = undefined;
    } finally {
      if (workspace) clearUnlockedVaultWorkspace(workspace);
      if (subsequentWorkspace) clearUnlockedVaultWorkspace(subsequentWorkspace);
      rootKey.fill(0);
      personalVaultKey.fill(0);
      unlockKey.fill(0);
      salt.fill(0);
      legacyRootEnvelope.nonce.fill(0);
      legacyRootEnvelope.ciphertext.fill(0);
      legacyRootCiphertext.fill(0);
      legacyPersonalKeyEnvelope.nonce.fill(0);
      legacyPersonalKeyEnvelope.ciphertext.fill(0);
      legacyPersonalKeyCiphertext.fill(0);
      legacyPersonalNameEnvelope.nonce.fill(0);
      legacyPersonalNameEnvelope.ciphertext.fill(0);
      legacyPersonalNameCiphertext.fill(0);
      legacyOfflineAccountEnvelope.nonce.fill(0);
      legacyOfflineAccountEnvelope.ciphertext.fill(0);
      legacyOfflineAccountCiphertext.fill(0);
      clearPrivateKey(identity.privateKey);
    }
  });
});

async function encryptWithContext(
  key: Uint8Array,
  plaintext: Uint8Array | string,
  context: Parameters<typeof browserClientCryptoPort.encryptPayloadWithContext>[2],
): Promise<Uint8Array> {
  const bytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
  const envelope = await browserClientCryptoPort.encryptPayloadWithContext(key, bytes, context);
  try {
    return browserClientCryptoPort.serializeEncryptedEnvelope(envelope);
  } finally {
    envelope.nonce.fill(0);
    envelope.ciphertext.fill(0);
    if (typeof plaintext === "string") bytes.fill(0);
  }
}

function createWorkspaceResponse(input: {
  encryptedPrivateKey: string;
  encryptedPersonalName: string;
  encryptedSharedName: string;
  encryptedSharedKey: string;
  encryptedSharedAccount: string;
  vaultUnlockSalt: string;
  wrappedRootKey: string;
  wrappedPersonalVaultKey: string;
  publicKey: PortableJsonWebKey;
}): AuthorizedWorkspaceResponse {
  return {
    responseVersion: 1,
    workspaceSynchronizationToken: "synthetic-workspace-sync",
    synchronizedAt: "2026-09-27T00:00:00.000Z",
    personalSnapshot: {
      schemaVersion: 3,
      profileId: "synthetic-profile",
      synchronizedAt: "2026-09-27T00:00:00.000Z",
      synchronizationToken: "synthetic-personal-sync",
      cryptoProfile: {
        vaultUnlockSalt: input.vaultUnlockSalt,
        wrappedUserRootKey: input.wrappedRootKey,
        encryptedPersonalVaultKey: input.wrappedPersonalVaultKey,
        encryptionVersion: 1,
      },
      personalVault: {
        vaultId: "personal-synthetic-vault",
        lifecycle: "ACTIVE",
        encryptedName: input.encryptedPersonalName,
        encryptionVersion: 1,
        accounts: [],
      },
    },
    sharedVaults: [
      {
        vaultId: "shared-synthetic-vault",
        lifecycle: "ACTIVE",
        role: "VIEWER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
          sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" },
        },
        encryptedName: input.encryptedSharedName,
        encryptionVersion: 1,
        encryptedVaultKey: input.encryptedSharedKey,
        keyVersion: 1,
        accounts: [
          {
            id: "shared-synthetic-account",
            encryptedPayload: input.encryptedSharedAccount,
            encryptionVersion: 1,
            revision: 1,
          },
        ],
      },
    ],
    userEncryptionIdentity: {
      publicKey: input.publicKey,
      encryptedPrivateKey: input.encryptedPrivateKey,
      encryptionVersion: 1,
    },
  };
}

function createWorkspacePorts(input: {
  response: AuthorizedWorkspaceResponse;
  rootKey: Uint8Array;
  unlockKey: Uint8Array;
  persistedSnapshots: AuthorizedWorkspaceResponse["personalSnapshot"][];
  fetchCount: () => void;
  profileCommitCount: () => void;
  sharedKeyWrapCommitCount?: () => void;
  migrationStore: EncryptedPayloadMigrationStore;
}): VaultWorkspacePlatformPorts {
  const crypto = browserClientCryptoPort;
  const accountPayload = createAuthenticatorAccountPayloadPort(crypto);
  return {
    network: { isOnline: () => true, subscribe: () => () => undefined },
    migrationDigest: browserSha256Digest,
    data: {
      snapshotStore: {
        listProfiles: async () => ({ profiles: [], migrationRequired: false }),
        read: async () => null,
        readByPersonalVaultId: async () => null,
        replace: async (snapshot) => {
          input.persistedSnapshots.push(snapshot);
        },
        removeVault: async () => undefined,
        removeProfile: async () => undefined,
        clearAll: async () => undefined,
      },
      fetchAuthorizedWorkspaceBundle: async () => {
        input.fetchCount();
        return input.response;
      },
      registerUserEncryptionIdentity: async () => false,
      migrateUserCryptoProfile: async (migration) => {
        const profile = input.response.personalSnapshot.cryptoProfile;
        const wrappedUpdate = prepareProfileWrapperUpdate("wrappedUserRootKey", migration.wrappedUserRootKey);
        const personalKeyUpdate = prepareProfileWrapperUpdate(
          "encryptedPersonalVaultKey",
          migration.encryptedPersonalVaultKey,
        );
        const updates = [wrappedUpdate, personalKeyUpdate];
        if (updates.includes("conflict")) return "conflict";
        const replacements = updates.filter(isProfileWrapperReplacement);
        if (replacements.length === 0) return "already-committed";
        for (const update of replacements) profile[update.field] = update.ciphertext;
        input.profileCommitCount();
        return "committed";

        function prepareProfileWrapperUpdate(
          field: "wrappedUserRootKey" | "encryptedPersonalVaultKey",
          requested: { expectedCiphertext: Uint8Array; replacementCiphertext: Uint8Array } | undefined,
        ):
          | { field: "wrappedUserRootKey" | "encryptedPersonalVaultKey"; ciphertext: string }
          | "already-committed"
          | "conflict"
          | undefined {
          if (!requested) return undefined;
          const current = base64ToBytes(profile[field]);
          try {
            if (bytesEqual(current, requested.replacementCiphertext)) return "already-committed";
            if (!bytesEqual(current, requested.expectedCiphertext)) return "conflict";
            return { field, ciphertext: bytesToBase64(requested.replacementCiphertext) };
          } finally {
            current.fill(0);
          }
        }

        function isProfileWrapperReplacement(
          update:
            | { field: "wrappedUserRootKey" | "encryptedPersonalVaultKey"; ciphertext: string }
            | "already-committed"
            | "conflict"
            | undefined,
        ): update is { field: "wrappedUserRootKey" | "encryptedPersonalVaultKey"; ciphertext: string } {
          return typeof update === "object" && update !== null;
        }
      },
      migratePersonalVaultName: async (_vaultId, _keyVersion, migration) =>
        commitOpaqueMigration(input.response.personalSnapshot.personalVault.encryptedName, migration, (replacement) => {
          input.response.personalSnapshot.personalVault.encryptedName = replacement;
        }),
      migrateSharedVaultName: async (_vaultId, _keyVersion, migration) => {
        const vault = input.response.sharedVaults[0];
        if (!vault) return "conflict";
        return commitOpaqueMigration(vault.encryptedName, migration, (replacement) => {
          vault.encryptedName = replacement;
        });
      },
      migrateSharedVaultKeyWrap: async (_vaultId, _keyVersion, migration) => {
        const vault = input.response.sharedVaults[0];
        if (!vault) return "conflict";
        const result = await commitOpaqueMigration(vault.encryptedVaultKey, migration, (replacement) => {
          vault.encryptedVaultKey = replacement;
        });
        if (result === "committed") input.sharedKeyWrapCommitCount?.();
        return result;
      },
      migratePersonalAuthenticatorAccount: async (_vaultId, accountId, _revision, _keyVersion, migration) => {
        const account = input.response.personalSnapshot.personalVault.accounts.find(({ id }) => id === accountId);
        if (!account) return "conflict";
        return commitOpaqueMigration(account.encryptedPayload, migration, (replacement) => {
          account.encryptedPayload = replacement;
        });
      },
      migrateSharedAuthenticatorAccount: async (_vaultId, _accountId, _revision, _keyVersion, migration) => {
        const account = input.response.sharedVaults[0]?.accounts[0];
        if (!account) return "conflict";
        return commitOpaqueMigration(account.encryptedPayload, migration, (replacement) => {
          account.encryptedPayload = replacement;
        });
      },
    },
    crypto: {
      unlockPersonalVault: (secret, profile) =>
        unlockPersonalVault(secret, profile, {
          crypto,
          keyDerivation: {
            deriveArgon2id: async (candidate) =>
              candidate === "synthetic passphrase" ? input.unlockKey.slice() : new Uint8Array(32).fill(99),
          },
        }),
      unlockPersonalVaultWithUserRootKey: (key, profile) => unlockPersonalVaultWithUserRootKey(key, profile, crypto),
      recoverUserRootKeyWithRememberedBrowser: async () => input.rootKey.slice(),
      recoverUserRootKeyWithPasskey: async () => input.rootKey.slice(),
      decryptPayload: (key, envelope) => crypto.decryptPayload(key, envelope),
      decryptPayloadWithContext: (key, envelope, context) => crypto.decryptPayloadWithContext(key, envelope, context),
      encryptPayloadWithContext: (key, plaintext, context) => crypto.encryptPayloadWithContext(key, plaintext, context),
      serializeEncryptedEnvelope: (envelope) => crypto.serializeEncryptedEnvelope(envelope),
      deserializeEncryptedEnvelope: (bytes) => crypto.deserializeEncryptedEnvelope(bytes),
      recoverOrMigratePrivateKey: (key, ciphertext, publicKey, keyVersion) => {
        if (ciphertext[0] !== 1) {
          return recoverUserEncryptionPrivateKeyWithCrypto(
            key,
            crypto.deserializeEncryptedEnvelope(ciphertext),
            crypto,
          );
        }
        return migrateUserEncryptionPrivateKeyWithCrypto(
          key,
          ciphertext,
          publicKey,
          crypto,
          browserSha256Digest,
          input.migrationStore,
        ).then((privateKey) => {
          if (keyVersion !== 1) {
            clearPrivateKey(privateKey);
            throw new Error("Unexpected synthetic identity generation.");
          }
          return privateKey;
        });
      },
      createUserEncryptionIdentity: (key) => createUserEncryptionIdentityWithCrypto(key, crypto),
      unwrapSharedVaultKey: (key, encryptedKey, context) =>
        unwrapSharedVaultKeyWithCrypto(crypto, key, encryptedKey, context),
      migrateSharedVaultKeyWrap: (rootKey, encryptedKey, privateKey, publicKey, context, store) =>
        migrateLegacySharedVaultKeyWrapWithCrypto(
          rootKey,
          encryptedKey,
          privateKey,
          publicKey,
          context,
          crypto,
          browserSha256Digest,
          store,
        ),
      decryptAccountConfiguration: (key, encryptedPayload, context) =>
        accountPayload.decryptAccountConfiguration(key, encryptedPayload, context),
      parseDecryptedAccountPayload: accountPayload.parseDecryptedAccountPayload,
    },
  };
}

async function commitOpaqueMigration(
  currentCiphertext: string,
  migration: EncryptedPayloadMigrationCommit,
  commit: (replacementCiphertext: string) => void,
): Promise<"committed" | "already-committed" | "conflict"> {
  const current = base64ToBytes(currentCiphertext);
  let currentDigest: Uint8Array | undefined;
  let replacementDigest: Uint8Array | undefined;
  try {
    currentDigest = await browserSha256Digest.digestSha256(current);
    replacementDigest = await browserSha256Digest.digestSha256(migration.replacementCiphertext);
    const currentFingerprint = bytesToBase64Url(currentDigest);
    const replacementFingerprint = bytesToBase64Url(replacementDigest);
    if (currentFingerprint === migration.replacementCiphertextDigest) return "already-committed";
    if (
      serializedEnvelopeVersion(current) !== migration.expectedEnvelopeVersion ||
      currentFingerprint !== migration.expectedCiphertextDigest ||
      migration.replacementEnvelopeVersion !== 2 ||
      serializedEnvelopeVersion(migration.replacementCiphertext) !== 2 ||
      replacementFingerprint !== migration.replacementCiphertextDigest ||
      migration.operationId !== replacementFingerprint
    )
      return "conflict";
    commit(bytesToBase64(migration.replacementCiphertext));
    return "committed";
  } finally {
    current.fill(0);
    currentDigest?.fill(0);
    replacementDigest?.fill(0);
  }
}

function serializedEnvelopeVersion(bytes: Uint8Array): number | undefined {
  if (bytes[0] !== 0x7b) return bytes[0] === 1 || bytes[0] === 2 ? bytes[0] : undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const version = Reflect.get(value, "version");
    return version === 1 || version === 2 ? version : undefined;
  } catch {
    return undefined;
  }
}

function requireUserEncryptionIdentity(response: AuthorizedWorkspaceResponse) {
  const identity = response.userEncryptionIdentity;
  if (!identity) throw new Error("Synthetic workspace is missing its User Encryption Identity.");
  return identity;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function clearPrivateKey(privateKey: PortableJsonWebKey): void {
  Reflect.set(privateKey, "x", "");
  Reflect.set(privateKey, "y", "");
  Reflect.set(privateKey, "d", "");
}

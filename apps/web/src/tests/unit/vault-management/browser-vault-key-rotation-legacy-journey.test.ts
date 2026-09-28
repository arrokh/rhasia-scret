import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getJson: vi.fn(), patchEmpty: vi.fn() }));
vi.mock("@/shared/infrastructure/browser-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/infrastructure/browser-api-client")>();
  return { ...actual, browserApiClient: mocks };
});

import {
  base64ToBytes,
  bytesToBase64,
  createAuthenticatorAccountPayloadPort,
  type PortableJsonWebKey,
} from "@rhasia-scret/client-vault-core";
import type {
  BrowserVaultKeyRotationRequest,
  BrowserVaultKeyRotationSnapshot,
} from "@/modules/vault-management/infrastructure/browser-vault-key-rotation-client";
import { loadBrowserVaultKeyRotationSnapshot } from "@/modules/vault-management/infrastructure/browser-vault-key-rotation-client";
import {
  prepareBrowserVaultKeyRotation,
  submitPreparedBrowserVaultKeyRotation,
} from "@/modules/vault-management/infrastructure/browser-vault-key-rotation-workflow";
import { browserClientCryptoPort } from "@/modules/crypto/infrastructure/browser-client-crypto-port";
import { parseBrowserPublicEncryptionKey } from "@/shared/infrastructure/browser-public-encryption-key";

describe("legacy Shared Vault key-rotation client journey", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("retrieves v1 name/account data, commits the validated rotation, then uses v2 data", async () => {
    const oldVaultKey = browserClientCryptoPort.generateSymmetricKey();
    const userEncryptionIdentity = await browserClientCryptoPort.generateUserEncryptionKeyPair();
    const vaultId = "shared-synthetic-vault";
    const userId = "synthetic-member";
    const name = "Shared Synthetic Vault";
    const accountPlaintext = new TextEncoder().encode(
      JSON.stringify({
        issuer: "Example Issuer",
        accountName: "sample@example.invalid",
        secret: "AQIDBA==",
        algorithm: "SHA-1",
        digits: 6,
        period: 30,
      }),
    );
    const legacyNamePlaintext = new TextEncoder().encode(name);
    const legacyNameEnvelope = await browserClientCryptoPort.encryptPayload(oldVaultKey, legacyNamePlaintext);
    const legacyAccountEnvelope = await browserClientCryptoPort.encryptPayload(oldVaultKey, accountPlaintext);
    const legacyName = browserClientCryptoPort.serializeEncryptedEnvelope(legacyNameEnvelope);
    const legacyAccount = browserClientCryptoPort.serializeEncryptedEnvelope(legacyAccountEnvelope);
    const legacyNameParsed = browserClientCryptoPort.deserializeEncryptedEnvelope(legacyName);
    const legacyAccountParsed = browserClientCryptoPort.deserializeEncryptedEnvelope(legacyAccount);
    const publicKey = parseBrowserPublicEncryptionKey(userEncryptionIdentity.publicKey);
    const initialSnapshot: BrowserVaultKeyRotationSnapshot = {
      vaultId,
      encryptedName: bytesToBase64(legacyName),
      encryptionVersion: 1,
      currentKeyVersion: 1,
      pendingInvitationCount: 0,
      accounts: [
        {
          id: "synthetic-account",
          encryptedPayload: bytesToBase64(legacyAccount),
          encryptionVersion: 1,
          revision: 7,
          recoverableDeleted: false,
        },
      ],
      members: [{ userId, publicKey, keyVersion: 1 }],
    };
    let serverSnapshot = initialSnapshot;
    let committedMemberPackage: string | undefined;

    mocks.getJson.mockImplementation(async () => cloneSnapshot(serverSnapshot));
    mocks.patchEmpty.mockImplementation(async (url: string, request: BrowserVaultKeyRotationRequest) => {
      if (
        url !== `/api/v1/shared-vaults/${vaultId}/rotation` ||
        serverSnapshot.currentKeyVersion !== request.expectedKeyVersion ||
        serverSnapshot.encryptedName !== request.expectedEncryptedName ||
        request.keyVersion !== request.expectedKeyVersion + 1
      )
        throw new Error("Synthetic CAS conflict.");
      const accountReplacement = request.accounts.find(({ id }) => id === "synthetic-account");
      const memberReplacement = request.memberPackages.find(({ userId: id }) => id === userId);
      if (
        !accountReplacement ||
        accountReplacement.revision !== 7 ||
        !memberReplacement ||
        !samePublicKey(memberReplacement.expectedPublicKey, publicKey)
      )
        throw new Error("Synthetic rotation batch is incomplete.");
      committedMemberPackage = memberReplacement.encryptedVaultKey;
      serverSnapshot = {
        ...serverSnapshot,
        encryptedName: request.encryptedName,
        currentKeyVersion: request.keyVersion,
        accounts: serverSnapshot.accounts.map((account) => ({
          ...account,
          encryptedPayload: accountReplacement.encryptedPayload,
          revision: account.revision + 1,
        })),
        members: serverSnapshot.members.map((member) => ({ ...member, keyVersion: request.keyVersion })),
      };
      throw new Error("Synthetic lost response after commit.");
    });

    const signal = new AbortController().signal;
    try {
      const prepared = await prepareBrowserVaultKeyRotation(vaultId, oldVaultKey, 1, signal);
      expect(prepared.snapshot.encryptedName).toBe(initialSnapshot.encryptedName);
      expect(prepared.request.accounts).toHaveLength(1);
      expect(prepared.request.memberPackages).toHaveLength(1);

      await expect(submitPreparedBrowserVaultKeyRotation(vaultId, prepared)).resolves.toBe("COMMITTED");
      expect(mocks.patchEmpty).toHaveBeenCalledTimes(1);

      const committed = await loadBrowserVaultKeyRotationSnapshot(vaultId);
      expect(committed.currentKeyVersion).toBe(2);
      expect(committed.accounts[0]?.revision).toBe(8);
      expect(committed.encryptedName).not.toBe(initialSnapshot.encryptedName);
      expect(committed.accounts[0]?.encryptedPayload).not.toBe(initialSnapshot.accounts[0]?.encryptedPayload);
      expect(committedMemberPackage).toBeDefined();

      const committedName = base64ToBytes(committed.encryptedName);
      const committedAccount = base64ToBytes(committed.accounts[0]!.encryptedPayload);
      const nameEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(committedName);
      const accountEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope(committedAccount);
      expect(nameEnvelope.version).toBe(2);
      expect(accountEnvelope.version).toBe(2);
      expect(nameEnvelope.nonce).not.toEqual(legacyNameParsed.nonce);
      expect(accountEnvelope.nonce).not.toEqual(legacyAccountParsed.nonce);

      const encodedMemberPackage = base64ToBytes(committedMemberPackage!);
      const memberPackage = browserClientCryptoPort.deserializeKeyWrapEnvelope(encodedMemberPackage);
      const newVaultKey = await browserClientCryptoPort.unwrapKeyForRecipientWithContext(
        memberPackage,
        userEncryptionIdentity.privateKey,
        {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          vaultId,
          recipientId: userId,
          keyVersion: committed.currentKeyVersion,
        },
      );
      const decryptedName = await browserClientCryptoPort.decryptPayloadWithContext(newVaultKey, nameEnvelope, {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      });
      expect(new TextDecoder("utf-8", { fatal: true }).decode(decryptedName)).toBe(name);
      const accountPayload = createAuthenticatorAccountPayloadPort(browserClientCryptoPort);
      const account = await accountPayload.decryptAccountConfiguration(newVaultKey, committedAccount, {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        vaultId,
        keyVersion: 1,
      });
      expect(account.issuer).toBe("Example Issuer");
      expect(account.accountName).toBe("sample@example.invalid");
      expect([...account.secret]).toEqual([1, 2, 3, 4]);

      decryptedName.fill(0);
      account.secret.fill(0);
      newVaultKey.fill(0);
      nameEnvelope.nonce.fill(0);
      nameEnvelope.ciphertext.fill(0);
      accountEnvelope.nonce.fill(0);
      accountEnvelope.ciphertext.fill(0);
      committedName.fill(0);
      committedAccount.fill(0);
      memberPackage.nonce.fill(0);
      memberPackage.ciphertext.fill(0);
      encodedMemberPackage.fill(0);
    } finally {
      oldVaultKey.fill(0);
      clearPrivateKey(userEncryptionIdentity.privateKey);
      legacyNamePlaintext.fill(0);
      legacyNameEnvelope.nonce.fill(0);
      legacyNameEnvelope.ciphertext.fill(0);
      legacyAccountEnvelope.nonce.fill(0);
      legacyAccountEnvelope.ciphertext.fill(0);
      legacyName.fill(0);
      legacyAccount.fill(0);
      legacyNameParsed.nonce.fill(0);
      legacyNameParsed.ciphertext.fill(0);
      legacyAccountParsed.nonce.fill(0);
      legacyAccountParsed.ciphertext.fill(0);
      accountPlaintext.fill(0);
    }
  });
});

function cloneSnapshot(snapshot: BrowserVaultKeyRotationSnapshot): BrowserVaultKeyRotationSnapshot {
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((account) => ({ ...account })),
    members: snapshot.members.map((member) => ({
      ...member,
      publicKey: { ...member.publicKey },
    })),
  };
}

function samePublicKey(left: PortableJsonWebKey, right: PortableJsonWebKey): boolean {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

function clearPrivateKey(privateKey: PortableJsonWebKey): void {
  Reflect.set(privateKey, "x", "");
  Reflect.set(privateKey, "y", "");
  Reflect.set(privateKey, "d", "");
}

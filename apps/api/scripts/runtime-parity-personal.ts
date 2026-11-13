import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { CompareOperation } from "./runtime-parity-types";

const OWNER_ALIAS = "parity-owner";
const IDENTITY_ALIAS = "parity-identity";
const IMPORTED_ACCOUNT_ID = "f0992e64-52aa-4f5a-9a77-8a536e728a11";

export async function runPersonalParityScenarios(compare: CompareOperation): Promise<void> {
  await compare({
    name: "current-user",
    method: "GET",
    path: "/v1/me",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  const personalVault = await compare({
    name: "ensure-personal-vault",
    method: "GET",
    path: "/v1/personal-vault",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  const tsVaultId = stringField(personalVault.ts.body, "id");
  const goVaultId = stringField(personalVault.go.body, "id");

  const publicKey = makePublicKey("A", "B");
  const privateKey = makeEnvelope(1, 7);
  const encryptedName = makeEnvelope(1, 8);
  const encryptedPersonalVaultKey = makeEnvelope(1, 9);
  await compare({
    name: "initialize-personal-vault",
    method: "POST",
    path: "/v1/personal-vault/initialize",
    expectedStatus: 204,
    alias: OWNER_ALIAS,
    body: {
      vaultUnlockSalt: encodeBase64(Uint8Array.from({ length: 16 }, (_, index) => index + 1)),
      wrappedUserRootKey: encodeBase64(makeEnvelope(1, 10)),
      encryptedPersonalVaultKey: encodeBase64(encryptedPersonalVaultKey),
      encryptedVaultName: encodeBase64(encryptedName),
      userEncryptionPublicKey: publicKey,
      encryptedUserPrivateKey: encodeBase64(privateKey),
      userEncryptionKeyVersion: 1,
      encryptionVersion: 1,
    },
  });
  await compare({
    name: "read-user-crypto-profile",
    method: "GET",
    path: "/v1/user-crypto-profile",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  await compare({
    name: "rewrap-user-root-key",
    method: "POST",
    path: "/v1/user-crypto-profile/rewrap",
    expectedStatus: 204,
    alias: OWNER_ALIAS,
    body: {
      vaultUnlockSalt: encodeBase64(Uint8Array.from({ length: 16 }, (_, index) => 21 - index)),
      wrappedUserRootKey: encodeBase64(makeEnvelope(1, 11)),
      encryptionVersion: 1,
    },
  });
  await compare({
    name: "migrate-user-crypto-profile-wrapper",
    method: "POST",
    path: "/v1/user-crypto-profile/migration",
    expectedStatus: 204,
    alias: OWNER_ALIAS,
    body: {
      encryptedPersonalVaultKey: {
        expectedCiphertext: encodeBase64(encryptedPersonalVaultKey),
        replacementCiphertext: encodeBase64(makeEnvelope(2, 12)),
      },
    },
  });
  await compare({
    name: "get-user-encryption-rotation-snapshot",
    method: "GET",
    path: "/v1/user-encryption-identity/rotation",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  const rotatedPublicKey = makePublicKey("C", "D");
  const rotatedPrivateKey = makeEnvelope(1, 13);
  await compare({
    name: "rotate-user-encryption-identity",
    method: "PATCH",
    path: "/v1/user-encryption-identity/rotation",
    expectedStatus: 204,
    alias: OWNER_ALIAS,
    body: {
      expectedPublicKey: publicKey,
      expectedEncryptedPrivateKey: encodeBase64(privateKey),
      expectedEncryptionVersion: 1,
      publicKey: rotatedPublicKey,
      encryptedPrivateKey: encodeBase64(rotatedPrivateKey),
      encryptionVersion: 1,
      memberships: [],
    },
  });
  const migratedPrivateKey = makeEnvelope(2, 14);
  const privateKeyMigrationDigest = digestBase64Url(migratedPrivateKey);
  await compare({
    name: "migrate-user-encryption-private-key",
    method: "POST",
    path: "/v1/user-encryption-identity/migration",
    expectedStatus: 204,
    alias: OWNER_ALIAS,
    body: {
      expectedEnvelopeVersion: 1,
      replacementEnvelopeVersion: 2,
      userEncryptionKeyVersion: 1,
      expectedCiphertextDigest: digestBase64Url(rotatedPrivateKey),
      replacementCiphertextDigest: privateKeyMigrationDigest,
      encryptedPrivateKey: encodeBase64(migratedPrivateKey),
      operationId: privateKeyMigrationDigest,
    },
  });

  const replacementName = makeEnvelope(2, 15);
  const replacementNameDigest = digestBase64Url(replacementName);
  await compare(
    {
      name: "migrate-personal-vault-name",
      method: "POST",
      path: "/v1/personal-vault/name/migration",
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        vaultId: tsVaultId,
        expectedKeyVersion: 1,
        expectedEnvelopeVersion: 1,
        replacementEnvelopeVersion: 2,
        expectedCiphertextDigest: digestBase64Url(encryptedName),
        replacementCiphertextDigest: replacementNameDigest,
        replacementCiphertext: encodeBase64(replacementName),
        operationId: replacementNameDigest,
      },
    },
    {
      name: "migrate-personal-vault-name",
      method: "POST",
      path: "/v1/personal-vault/name/migration",
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        vaultId: goVaultId,
        expectedKeyVersion: 1,
        expectedEnvelopeVersion: 1,
        replacementEnvelopeVersion: 2,
        expectedCiphertextDigest: digestBase64Url(encryptedName),
        replacementCiphertextDigest: replacementNameDigest,
        replacementCiphertext: encodeBase64(replacementName),
        operationId: replacementNameDigest,
      },
    },
  );

  const initialAccountPayload = makeEnvelope(1, 16);
  const createdAccount = await compare(
    {
      name: "create-personal-account",
      method: "POST",
      path: `/v1/vaults/${tsVaultId}/accounts`,
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: { encryptedPayload: encodeBase64(initialAccountPayload), encryptionVersion: 1 },
    },
    {
      name: "create-personal-account",
      method: "POST",
      path: `/v1/vaults/${goVaultId}/accounts`,
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: { encryptedPayload: encodeBase64(initialAccountPayload), encryptionVersion: 1 },
    },
  );
  const tsAccountId = stringField(createdAccount.ts.body, "id");
  const goAccountId = stringField(createdAccount.go.body, "id");
  await compare(
    {
      name: "list-personal-accounts",
      method: "GET",
      path: `/v1/vaults/${tsVaultId}/accounts`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "list-personal-accounts",
      method: "GET",
      path: `/v1/vaults/${goVaultId}/accounts`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );

  const updatedAccountPayload = makeEnvelope(1, 17);
  await compare(
    {
      name: "update-personal-account",
      method: "PATCH",
      path: `/v1/vaults/${tsVaultId}/accounts`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        accountId: tsAccountId,
        expectedRevision: 1,
        encryptedPayload: encodeBase64(updatedAccountPayload),
        encryptionVersion: 1,
      },
    },
    {
      name: "update-personal-account",
      method: "PATCH",
      path: `/v1/vaults/${goVaultId}/accounts`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        accountId: goAccountId,
        expectedRevision: 1,
        encryptedPayload: encodeBase64(updatedAccountPayload),
        encryptionVersion: 1,
      },
    },
  );
  const migratedAccountPayload = makeEnvelope(2, 18);
  const accountMigrationDigest = digestBase64Url(migratedAccountPayload);
  await compare(
    {
      name: "migrate-personal-account-payload",
      method: "POST",
      path: `/v1/vaults/${tsVaultId}/accounts/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: createAccountMigrationBody(
        tsAccountId,
        updatedAccountPayload,
        migratedAccountPayload,
        accountMigrationDigest,
      ),
    },
    {
      name: "migrate-personal-account-payload",
      method: "POST",
      path: `/v1/vaults/${goVaultId}/accounts/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: createAccountMigrationBody(
        goAccountId,
        updatedAccountPayload,
        migratedAccountPayload,
        accountMigrationDigest,
      ),
    },
  );
  await compare(
    {
      name: "delete-personal-account",
      method: "DELETE",
      path: `/v1/vaults/${tsVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: tsAccountId, expectedRevision: 2 },
    },
    {
      name: "delete-personal-account",
      method: "DELETE",
      path: `/v1/vaults/${goVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: goAccountId, expectedRevision: 2 },
    },
  );
  await compare(
    {
      name: "restore-personal-account",
      method: "PUT",
      path: `/v1/vaults/${tsVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: tsAccountId },
    },
    {
      name: "restore-personal-account",
      method: "PUT",
      path: `/v1/vaults/${goVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: goAccountId },
    },
  );

  await compare(
    {
      name: "import-encrypted-archive-into-personal-vault",
      method: "POST",
      path: "/v1/vault-imports",
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: {
        destination: { kind: "EXISTING", vaultId: tsVaultId, vaultType: "PERSONAL" },
        accounts: [
          {
            id: IMPORTED_ACCOUNT_ID,
            encryptedPayload: encodeBase64(makeEnvelope(1, 19)),
            encryptionVersion: 1,
          },
        ],
      },
    },
    {
      name: "import-encrypted-archive-into-personal-vault",
      method: "POST",
      path: "/v1/vault-imports",
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: {
        destination: { kind: "EXISTING", vaultId: goVaultId, vaultType: "PERSONAL" },
        accounts: [
          {
            id: IMPORTED_ACCOUNT_ID,
            encryptedPayload: encodeBase64(makeEnvelope(1, 19)),
            encryptionVersion: 1,
          },
        ],
      },
    },
  );
  await compare(
    {
      name: "record-personal-archive-export",
      method: "POST",
      path: `/v1/vaults/${tsVaultId}/archive-exports`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
    {
      name: "record-personal-archive-export",
      method: "POST",
      path: `/v1/vaults/${goVaultId}/archive-exports`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
  );
  await compare(
    {
      name: "record-personal-account-copy-audit",
      method: "POST",
      path: `/v1/vaults/${tsVaultId}/audit-events`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { eventType: "ACCOUNT_COPIED_TO_LOCAL", accountIds: [tsAccountId] },
    },
    {
      name: "record-personal-account-copy-audit",
      method: "POST",
      path: `/v1/vaults/${goVaultId}/audit-events`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { eventType: "ACCOUNT_COPIED_TO_LOCAL", accountIds: [goAccountId] },
    },
  );
  await compare(
    {
      name: "list-personal-vault-audit-events",
      method: "GET",
      path: `/v1/vaults/${tsVaultId}/audit-events?limit=10`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "list-personal-vault-audit-events",
      method: "GET",
      path: `/v1/vaults/${goVaultId}/audit-events?limit=10`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  const offlineBundle = await compare({
    name: "read-offline-sync-bundle",
    method: "GET",
    path: "/v1/sync/offline-bundle",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  const tsETag = offlineBundle.ts.headers.get("etag");
  const goETag = offlineBundle.go.headers.get("etag");
  if (!tsETag || !goETag) throw new Error("Offline sync responses must include their validators.");
  await compare(
    {
      name: "conditional-offline-sync-bundle",
      method: "GET",
      path: "/v1/sync/offline-bundle",
      expectedStatus: 304,
      alias: OWNER_ALIAS,
      headers: { "if-none-match": tsETag },
    },
    {
      name: "conditional-offline-sync-bundle",
      method: "GET",
      path: "/v1/sync/offline-bundle",
      expectedStatus: 304,
      alias: OWNER_ALIAS,
      headers: { "if-none-match": goETag },
    },
  );
  await compare({
    name: "read-workspace-sync-bundle",
    method: "GET",
    path: "/v1/sync/workspace-bundle",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  await compare({
    name: "check-personal-vault-reset-eligibility",
    method: "GET",
    path: "/v1/personal-vault/destructive-reset",
    expectedStatus: 200,
    alias: OWNER_ALIAS,
  });
  await compare({
    name: "reset-personal-vault-crypto-material",
    method: "POST",
    path: "/v1/personal-vault/destructive-reset",
    expectedStatus: 204,
    alias: OWNER_ALIAS,
    body: { confirmation: "HAPUS DATA BRANKAS" },
  });

  await compare({
    name: "register-user-encryption-identity",
    method: "PUT",
    path: "/v1/user-encryption-identity",
    expectedStatus: 204,
    alias: IDENTITY_ALIAS,
    body: {
      publicKey: makePublicKey("E", "F"),
      encryptedPrivateKey: encodeBase64(makeEnvelope(1, 31)),
      encryptionVersion: 1,
    },
  });
}

function createAccountMigrationBody(
  accountId: string,
  currentCiphertext: Uint8Array,
  replacementCiphertext: Uint8Array,
  replacementDigest: string,
): Record<string, unknown> {
  return {
    accountId,
    expectedRevision: 2,
    expectedKeyVersion: 1,
    expectedEnvelopeVersion: 1,
    replacementEnvelopeVersion: 2,
    expectedCiphertextDigest: digestBase64Url(currentCiphertext),
    replacementCiphertextDigest: replacementDigest,
    replacementCiphertext: encodeBase64(replacementCiphertext),
    operationId: replacementDigest,
  };
}

function makeEnvelope(version: 1 | 2, marker: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? version : (marker + index) % 256));
}

function makePublicKey(xCharacter: string, yCharacter: string): Record<string, string> {
  return { kty: "EC", crv: "P-256", x: xCharacter.repeat(43), y: yCharacter.repeat(43) };
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function digestBase64Url(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

function stringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string")
    throw new Error("Runtime parity response is missing a required identifier.");
  return value[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { createHash } from "node:crypto";
import type { CompareOperation, ComparedResponse } from "./runtime-parity-types";

const OWNER_ALIAS = "parity-identity";
const MEMBER_ALIAS = "parity-shared-member";
const OWNER_PUBLIC_KEY = makePublicKey("E", "F");
const MEMBER_PUBLIC_KEY = makePublicKey("G", "H");
const MEMBER_USER_ID = "c0000000000000000000000007";
const OWNER_KEY_VERSION = 1;

export async function runSharedParityScenarios(compare: CompareOperation): Promise<void> {
  await compare({
    name: "register-shared-member-encryption-identity",
    method: "PUT",
    path: "/v1/user-encryption-identity",
    expectedStatus: 204,
    alias: MEMBER_ALIAS,
    body: {
      publicKey: MEMBER_PUBLIC_KEY,
      encryptedPrivateKey: encodeBase64(makeEnvelope(1, 41)),
      encryptionVersion: 1,
    },
  });

  const encryptedName = makeEnvelope(1, 42);
  const created = await compare({
    name: "create-shared-vault",
    method: "POST",
    path: "/v1/shared-vaults",
    expectedStatus: 201,
    alias: OWNER_ALIAS,
    body: {
      encryptedName: encodeBase64(encryptedName),
      encryptedOwnerVaultKey: encodeBase64(makeEnvelope(1, 43)),
      expectedOwnerPublicKey: OWNER_PUBLIC_KEY,
      encryptionVersion: 1,
    },
  });
  const tsVaultId = stringField(created.ts.body, "id");
  const goVaultId = stringField(created.go.body, "id");

  await compare(
    {
      name: "list-shared-vaults-as-owner",
      method: "GET",
      path: "/v1/shared-vaults",
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "list-shared-vaults-as-owner",
      method: "GET",
      path: "/v1/shared-vaults",
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  await compare(
    {
      name: "read-shared-vault-as-owner",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "read-shared-vault-as-owner",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );

  await compare(
    {
      name: "rename-shared-vault",
      method: "PATCH",
      path: `/v1/shared-vaults/${tsVaultId}`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        encryptedName: encodeBase64(makeEnvelope(1, 44)),
        encryptionVersion: 1,
        expectedKeyVersion: OWNER_KEY_VERSION,
      },
    },
    {
      name: "rename-shared-vault",
      method: "PATCH",
      path: `/v1/shared-vaults/${goVaultId}`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        encryptedName: encodeBase64(makeEnvelope(1, 44)),
        encryptionVersion: 1,
        expectedKeyVersion: OWNER_KEY_VERSION,
      },
    },
  );

  const renamed = await compare(
    {
      name: "read-renamed-shared-vault",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "read-renamed-shared-vault",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  const tsName = decodeBase64(stringField(renamed.ts.body, "encryptedName"));
  const goName = decodeBase64(stringField(renamed.go.body, "encryptedName"));
  const replacementName = makeEnvelope(2, 45);
  const nameMigrationDigest = digestBase64Url(replacementName);
  await compare(
    {
      name: "migrate-shared-vault-name-envelope",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/name/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        ...migrationBody(tsName, replacementName),
        expectedKeyVersion: OWNER_KEY_VERSION,
        operationId: nameMigrationDigest,
      },
    },
    {
      name: "migrate-shared-vault-name-envelope",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/name/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        ...migrationBody(goName, replacementName),
        expectedKeyVersion: OWNER_KEY_VERSION,
        operationId: nameMigrationDigest,
      },
    },
  );

  const beforeKeyWrapMigration = await compare(
    {
      name: "read-shared-vault-key-wrap-before-migration",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "read-shared-vault-key-wrap-before-migration",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  const tsKeyWrap = decodeBase64(stringField(beforeKeyWrapMigration.ts.body, "encryptedVaultKey"));
  const goKeyWrap = decodeBase64(stringField(beforeKeyWrapMigration.go.body, "encryptedVaultKey"));
  const replacementKeyWrap = makeKeyWrapEnvelopeV2();
  const keyWrapMigrationDigest = digestBase64Url(replacementKeyWrap);
  await compare(
    {
      name: "migrate-shared-vault-key-wrap-envelope",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/key-wrap/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        ...migrationBody(tsKeyWrap, replacementKeyWrap),
        expectedKeyVersion: OWNER_KEY_VERSION,
        operationId: keyWrapMigrationDigest,
      },
    },
    {
      name: "migrate-shared-vault-key-wrap-envelope",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/key-wrap/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        ...migrationBody(goKeyWrap, replacementKeyWrap),
        expectedKeyVersion: OWNER_KEY_VERSION,
        operationId: keyWrapMigrationDigest,
      },
    },
  );

  const initialAccount = makeEnvelope(1, 47);
  const accountCreated = await compare(
    {
      name: "create-shared-vault-account",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: {
        encryptedPayload: encodeBase64(initialAccount),
        encryptionVersion: 1,
        expectedKeyVersion: OWNER_KEY_VERSION,
      },
    },
    {
      name: "create-shared-vault-account",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: {
        encryptedPayload: encodeBase64(initialAccount),
        encryptionVersion: 1,
        expectedKeyVersion: OWNER_KEY_VERSION,
      },
    },
  );
  const tsAccountId = stringField(accountCreated.ts.body, "id");
  const goAccountId = stringField(accountCreated.go.body, "id");
  const updatedAccount = makeEnvelope(1, 48);
  await compare(
    {
      name: "update-shared-vault-account",
      method: "PATCH",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        accountId: tsAccountId,
        expectedRevision: 1,
        encryptedPayload: encodeBase64(updatedAccount),
        encryptionVersion: 1,
        expectedKeyVersion: OWNER_KEY_VERSION,
      },
    },
    {
      name: "update-shared-vault-account",
      method: "PATCH",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        accountId: goAccountId,
        expectedRevision: 1,
        encryptedPayload: encodeBase64(updatedAccount),
        encryptionVersion: 1,
        expectedKeyVersion: OWNER_KEY_VERSION,
      },
    },
  );
  const migratedAccount = makeEnvelope(2, 49);
  const accountMigrationDigest = digestBase64Url(migratedAccount);
  await compare(
    {
      name: "migrate-shared-vault-account-envelope",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/accounts/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        ...migrationBody(updatedAccount, migratedAccount),
        accountId: tsAccountId,
        expectedRevision: 2,
        expectedKeyVersion: OWNER_KEY_VERSION,
        operationId: accountMigrationDigest,
      },
    },
    {
      name: "migrate-shared-vault-account-envelope",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/accounts/migration`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: {
        ...migrationBody(updatedAccount, migratedAccount),
        accountId: goAccountId,
        expectedRevision: 2,
        expectedKeyVersion: OWNER_KEY_VERSION,
        operationId: accountMigrationDigest,
      },
    },
  );
  await compare(
    {
      name: "soft-delete-shared-vault-account",
      method: "DELETE",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: tsAccountId, expectedRevision: 2 },
    },
    {
      name: "soft-delete-shared-vault-account",
      method: "DELETE",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: goAccountId, expectedRevision: 2 },
    },
  );
  await compare(
    {
      name: "restore-shared-vault-account",
      method: "PUT",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: tsAccountId },
    },
    {
      name: "restore-shared-vault-account",
      method: "PUT",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: { accountId: goAccountId },
    },
  );

  const firstLinkVerifier = encodeBase64(new Uint8Array(32).fill(1));
  const firstInvitation = await createInvitation(compare, tsVaultId, goVaultId, firstLinkVerifier, OWNER_KEY_VERSION);
  await compare(
    {
      name: "list-shared-vault-pending-participants",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}/participants`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "list-shared-vault-pending-participants",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}/participants`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  await redeemInvitation(compare, tsVaultId, goVaultId, firstInvitation, firstLinkVerifier, OWNER_KEY_VERSION);
  await compare(
    {
      name: "list-shared-vaults-as-member",
      method: "GET",
      path: "/v1/shared-vaults",
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
    {
      name: "list-shared-vaults-as-member",
      method: "GET",
      path: "/v1/shared-vaults",
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
  );
  await compare(
    {
      name: "read-shared-vault-as-member",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}`,
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
    {
      name: "read-shared-vault-as-member",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}`,
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
  );

  const defaults = await compare(
    {
      name: "read-shared-vault-member-permission-defaults",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}/member-permissions`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "read-shared-vault-member-permission-defaults",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}/member-permissions`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  const tsDefaultRevision = numberField(defaults.ts.body, "vaultDefaultAccountPermissionsRevision");
  const goDefaultRevision = numberField(defaults.go.body, "vaultDefaultAccountPermissionsRevision");
  await compare(
    {
      name: "update-shared-vault-member-permission-defaults",
      method: "PATCH",
      path: `/v1/shared-vaults/${tsVaultId}/member-permissions`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        expectedRevision: tsDefaultRevision,
        canAddAccounts: true,
        canEditAccounts: false,
        canDeleteAccounts: false,
      },
    },
    {
      name: "update-shared-vault-member-permission-defaults",
      method: "PATCH",
      path: `/v1/shared-vaults/${goVaultId}/member-permissions`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        expectedRevision: goDefaultRevision,
        canAddAccounts: true,
        canEditAccounts: false,
        canDeleteAccounts: false,
      },
    },
  );

  const participants = await compare(
    {
      name: "read-shared-vault-member-permission-revision",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}/participants`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "read-shared-vault-member-permission-revision",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}/participants`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  const tsMemberRevision = participantRevision(participants.ts, MEMBER_USER_ID);
  const goMemberRevision = participantRevision(participants.go, MEMBER_USER_ID);
  await compare(
    {
      name: "update-shared-vault-member-permission-overrides",
      method: "PATCH",
      path: `/v1/shared-vaults/${tsVaultId}/members/${MEMBER_USER_ID}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        expectedRevision: tsMemberRevision,
        canAddAccounts: null,
        canEditAccounts: true,
        canDeleteAccounts: false,
      },
    },
    {
      name: "update-shared-vault-member-permission-overrides",
      method: "PATCH",
      path: `/v1/shared-vaults/${goVaultId}/members/${MEMBER_USER_ID}`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
      body: {
        expectedRevision: goMemberRevision,
        canAddAccounts: null,
        canEditAccounts: true,
        canDeleteAccounts: false,
      },
    },
  );

  const rotation = await compare(
    {
      name: "read-shared-vault-rotation-snapshot",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}/rotation`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "read-shared-vault-rotation-snapshot",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}/rotation`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );
  await compare(
    {
      name: "rotate-shared-vault-key-and-member-packages",
      method: "PATCH",
      path: `/v1/shared-vaults/${tsVaultId}/rotation`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: createRotationBody(rotation.ts),
    },
    {
      name: "rotate-shared-vault-key-and-member-packages",
      method: "PATCH",
      path: `/v1/shared-vaults/${goVaultId}/rotation`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
      body: createRotationBody(rotation.go),
    },
  );

  const memberAccount = makeEnvelope(1, 50);
  const memberAccountCreated = await compare(
    {
      name: "create-member-shared-vault-account",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 201,
      alias: MEMBER_ALIAS,
      body: {
        encryptedPayload: encodeBase64(memberAccount),
        encryptionVersion: 1,
        expectedKeyVersion: 2,
      },
    },
    {
      name: "create-member-shared-vault-account",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 201,
      alias: MEMBER_ALIAS,
      body: {
        encryptedPayload: encodeBase64(memberAccount),
        encryptionVersion: 1,
        expectedKeyVersion: 2,
      },
    },
  );
  const tsMemberAccountId = stringField(memberAccountCreated.ts.body, "id");
  const goMemberAccountId = stringField(memberAccountCreated.go.body, "id");
  await compare(
    {
      name: "member-cannot-delete-shared-vault-account",
      method: "DELETE",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 403,
      alias: MEMBER_ALIAS,
      body: { accountId: tsMemberAccountId, expectedRevision: 1 },
    },
    {
      name: "member-cannot-delete-shared-vault-account",
      method: "DELETE",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 403,
      alias: MEMBER_ALIAS,
      body: { accountId: goMemberAccountId, expectedRevision: 1 },
    },
  );
  await compare(
    {
      name: "update-member-shared-vault-account",
      method: "PATCH",
      path: `/v1/shared-vaults/${tsVaultId}/accounts`,
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
      body: {
        accountId: tsMemberAccountId,
        expectedRevision: 1,
        encryptedPayload: encodeBase64(makeEnvelope(1, 51)),
        encryptionVersion: 1,
        expectedKeyVersion: 2,
      },
    },
    {
      name: "update-member-shared-vault-account",
      method: "PATCH",
      path: `/v1/shared-vaults/${goVaultId}/accounts`,
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
      body: {
        accountId: goMemberAccountId,
        expectedRevision: 1,
        encryptedPayload: encodeBase64(makeEnvelope(1, 51)),
        encryptionVersion: 1,
        expectedKeyVersion: 2,
      },
    },
  );
  await compare(
    {
      name: "record-shared-vault-account-access",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/audit-events`,
      expectedStatus: 204,
      alias: MEMBER_ALIAS,
      body: { eventType: "ACCOUNT_ACCESSED", accountId: tsMemberAccountId },
    },
    {
      name: "record-shared-vault-account-access",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/audit-events`,
      expectedStatus: 204,
      alias: MEMBER_ALIAS,
      body: { eventType: "ACCOUNT_ACCESSED", accountId: goMemberAccountId },
    },
  );
  await compare(
    {
      name: "list-shared-vault-audit-events",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}/audit-events`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
    {
      name: "list-shared-vault-audit-events",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}/audit-events`,
      expectedStatus: 200,
      alias: OWNER_ALIAS,
    },
  );

  await compare(
    {
      name: "leave-shared-vault-as-member",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/leave`,
      expectedStatus: 204,
      alias: MEMBER_ALIAS,
    },
    {
      name: "leave-shared-vault-as-member",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/leave`,
      expectedStatus: 204,
      alias: MEMBER_ALIAS,
    },
  );

  const canceledVerifier = encodeBase64(new Uint8Array(32).fill(2));
  const canceledInvitation = await createInvitation(compare, tsVaultId, goVaultId, canceledVerifier, 2);
  await compare(
    {
      name: "cancel-pending-shared-vault-invitation",
      method: "DELETE",
      path: `/v1/shared-vaults/${tsVaultId}/share-links/${canceledInvitation.ts}`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
    {
      name: "cancel-pending-shared-vault-invitation",
      method: "DELETE",
      path: `/v1/shared-vaults/${goVaultId}/share-links/${canceledInvitation.go}`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
  );

  const finalVerifier = encodeBase64(new Uint8Array(32).fill(3));
  const finalInvitation = await createInvitation(compare, tsVaultId, goVaultId, finalVerifier, 2);
  await redeemInvitation(compare, tsVaultId, goVaultId, finalInvitation, finalVerifier, 2);
  await compare(
    {
      name: "revoke-shared-vault-membership",
      method: "DELETE",
      path: `/v1/shared-vaults/${tsVaultId}/members/${MEMBER_USER_ID}`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
    {
      name: "revoke-shared-vault-membership",
      method: "DELETE",
      path: `/v1/shared-vaults/${goVaultId}/members/${MEMBER_USER_ID}`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
  );
  const memberVaultsAfterRevocation = await compare(
    {
      name: "member-loses-shared-vault-after-revocation",
      method: "GET",
      path: "/v1/shared-vaults",
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
    {
      name: "member-loses-shared-vault-after-revocation",
      method: "GET",
      path: "/v1/shared-vaults",
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
  );
  assertEmptyArray(memberVaultsAfterRevocation.ts.body, "TypeScript");
  assertEmptyArray(memberVaultsAfterRevocation.go.body, "Go");
  await compare(
    {
      name: "revoked-member-cannot-read-shared-vault",
      method: "GET",
      path: `/v1/shared-vaults/${tsVaultId}`,
      expectedStatus: 404,
      alias: MEMBER_ALIAS,
    },
    {
      name: "revoked-member-cannot-read-shared-vault",
      method: "GET",
      path: `/v1/shared-vaults/${goVaultId}`,
      expectedStatus: 404,
      alias: MEMBER_ALIAS,
    },
  );

  await compare(
    {
      name: "soft-delete-shared-vault",
      method: "DELETE",
      path: `/v1/shared-vaults/${tsVaultId}/lifecycle`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
    {
      name: "soft-delete-shared-vault",
      method: "DELETE",
      path: `/v1/shared-vaults/${goVaultId}/lifecycle`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
  );
  await compare(
    {
      name: "restore-shared-vault",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/lifecycle`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
    {
      name: "restore-shared-vault",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/lifecycle`,
      expectedStatus: 204,
      alias: OWNER_ALIAS,
    },
  );
}

async function createInvitation(
  compare: CompareOperation,
  tsVaultId: string,
  goVaultId: string,
  linkVerifier: string,
  expectedKeyVersion: number,
): Promise<Readonly<{ ts: string; go: string }>> {
  const encryptedPackage = encodeBase64(makeEnvelope(1, 52 + expectedKeyVersion));
  const invitation = await compare(
    {
      name: "create-shared-vault-invitation",
      method: "POST",
      path: `/v1/shared-vaults/${tsVaultId}/share-links`,
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: {
        recipientEmail: "shared-member@example.test",
        linkVerifier,
        encryptedPackage,
        expectedKeyVersion,
      },
    },
    {
      name: "create-shared-vault-invitation",
      method: "POST",
      path: `/v1/shared-vaults/${goVaultId}/share-links`,
      expectedStatus: 201,
      alias: OWNER_ALIAS,
      body: {
        recipientEmail: "shared-member@example.test",
        linkVerifier,
        encryptedPackage,
        expectedKeyVersion,
      },
    },
  );
  return { ts: stringField(invitation.ts.body, "id"), go: stringField(invitation.go.body, "id") };
}

async function redeemInvitation(
  compare: CompareOperation,
  tsVaultId: string,
  goVaultId: string,
  invitation: Readonly<{ ts: string; go: string }>,
  linkVerifier: string,
  keyVersion: number,
): Promise<void> {
  await compare(
    {
      name: "resolve-shared-vault-invitation",
      method: "GET",
      path: `/v1/secure-share-links?verifier=${encodeURIComponent(linkVerifier)}`,
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
    {
      name: "resolve-shared-vault-invitation",
      method: "GET",
      path: `/v1/secure-share-links?verifier=${encodeURIComponent(linkVerifier)}`,
      expectedStatus: 200,
      alias: MEMBER_ALIAS,
    },
  );
  await compare(
    {
      name: "redeem-shared-vault-invitation",
      method: "POST",
      path: "/v1/secure-share-links",
      expectedStatus: 204,
      alias: MEMBER_ALIAS,
      body: {
        invitationId: invitation.ts,
        encryptedVaultKey: encodeBase64(makeEnvelope(1, 61 + keyVersion)),
        keyVersion,
        expectedPublicKey: MEMBER_PUBLIC_KEY,
      },
    },
    {
      name: "redeem-shared-vault-invitation",
      method: "POST",
      path: "/v1/secure-share-links",
      expectedStatus: 204,
      alias: MEMBER_ALIAS,
      body: {
        invitationId: invitation.go,
        encryptedVaultKey: encodeBase64(makeEnvelope(1, 61 + keyVersion)),
        keyVersion,
        expectedPublicKey: MEMBER_PUBLIC_KEY,
      },
    },
  );
}

function createRotationBody(response: ComparedResponse): Record<string, unknown> {
  const body = objectValue(response.body, "rotation snapshot");
  const currentKeyVersion = numberField(body, "currentKeyVersion");
  const members = arrayField(body, "members").map((member) => ({
    userId: stringField(member, "userId"),
    expectedPublicKey: objectField(member, "publicKey"),
    encryptedVaultKey: encodeBase64(makeEnvelope(1, 62 + currentKeyVersion)),
  }));
  const accounts = arrayField(body, "accounts").map((account) => ({
    id: stringField(account, "id"),
    revision: numberField(account, "revision"),
    encryptedPayload: stringField(account, "encryptedPayload"),
  }));
  return {
    expectedEncryptedName: stringField(body, "encryptedName"),
    encryptedName: encodeBase64(makeEnvelope(1, 63 + currentKeyVersion)),
    encryptionVersion: numberField(body, "encryptionVersion"),
    expectedKeyVersion: currentKeyVersion,
    keyVersion: currentKeyVersion + 1,
    accounts,
    memberPackages: members,
  };
}

function assertEmptyArray(value: unknown, runtime: string): void {
  if (!Array.isArray(value) || value.length !== 0)
    throw new Error(`${runtime} runtime retained shared-vault access after membership revocation.`);
}

function participantRevision(response: ComparedResponse, userId: string): number {
  const participants = arrayField(objectValue(response.body, "participants response"), "participants");
  const member = participants.find((participant) => isRecord(participant) && participant.userId === userId);
  if (!member || !isRecord(member)) throw new Error("Runtime parity did not find the shared member participant.");
  return numberField(member, "permissionsRevision");
}

function migrationBody(expected: Uint8Array, replacement: Uint8Array): Record<string, unknown> {
  const replacementDigest = digestBase64Url(replacement);
  return {
    expectedEnvelopeVersion: 1,
    replacementEnvelopeVersion: 2,
    expectedCiphertextDigest: digestBase64Url(expected),
    replacementCiphertextDigest: replacementDigest,
    replacementCiphertext: encodeBase64(replacement),
    operationId: replacementDigest,
  };
}

function makePublicKey(xCharacter: string, yCharacter: string): Record<string, string> {
  return { kty: "EC", crv: "P-256", x: xCharacter.repeat(43), y: yCharacter.repeat(43) };
}

function makeEnvelope(version: 1 | 2, marker: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? version : (marker + index) % 256));
}

function makeKeyWrapEnvelopeV2(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      version: 2,
      nonce: "B".repeat(16),
      ciphertext: "A".repeat(64),
      ephemeralPublicKey: { kty: "EC", crv: "P-256", x: "C".repeat(43), y: "D".repeat(43) },
    }),
  );
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function digestBase64Url(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  const record = objectValue(value, `response field ${field}`)[field];
  if (!isRecord(record)) throw new Error(`Runtime parity response field ${field} is not an object.`);
  return record;
}

function arrayField(value: unknown, field: string): unknown[] {
  const array = objectValue(value, `response field ${field}`)[field];
  if (!Array.isArray(array)) throw new Error(`Runtime parity response field ${field} is not an array.`);
  return array;
}

function numberField(value: unknown, field: string): number {
  const number = objectValue(value, `response field ${field}`)[field];
  if (typeof number !== "number" || !Number.isSafeInteger(number))
    throw new Error(`Runtime parity response field ${field} is not an integer.`);
  return number;
}

function stringField(value: unknown, field: string): string {
  const string = objectValue(value, `response field ${field}`)[field];
  if (typeof string !== "string") throw new Error(`Runtime parity response field ${field} is not a string.`);
  return string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Runtime parity ${label} is not an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { publicEncryptionKeySchema } from "@api/http/public-encryption-key";
import {
  boundedEncryptedBlobSchema,
  MAX_ENCRYPTED_BLOB_BYTES,
  MAX_ROTATION_ACCOUNTS,
  MAX_ROTATION_MEMBER_PACKAGES,
  MAX_ROTATION_REQUEST_BYTES,
  safeParseJsonBody,
} from "@api/http/validation";
import { routeParamSchema } from "@api/http/validation";
import { z } from "zod";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const ciphertext = boundedEncryptedBlobSchema();
const rotationSchema = z
  .object({
    expectedEncryptedName: ciphertext,
    encryptedName: ciphertext,
    encryptionVersion: z.literal(1),
    expectedKeyVersion: z.number().int().positive(),
    keyVersion: z.number().int().positive(),
    accounts: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            revision: z.number().int().positive(),
            encryptedPayload: ciphertext,
          })
          .strict(),
      )
      .max(MAX_ROTATION_ACCOUNTS),
    memberPackages: z
      .array(
        z
          .object({
            userId: z.string().min(1).max(128),
            expectedPublicKey: publicEncryptionKeySchema,
            encryptedVaultKey: ciphertext,
          })
          .strict(),
      )
      .max(MAX_ROTATION_MEMBER_PACKAGES),
  })
  .strict()
  .superRefine(({ expectedKeyVersion, keyVersion, accounts, memberPackages }, context) => {
    if (keyVersion !== expectedKeyVersion + 1)
      context.addIssue({ code: "custom", path: ["keyVersion"], message: "Key generation must advance once." });
    if (new Set(accounts.map(({ id }) => id)).size !== accounts.length) {
      context.addIssue({ code: "custom", path: ["accounts"], message: "Account IDs must be unique." });
    }
    if (new Set(memberPackages.map(({ userId }) => userId)).size !== memberPackages.length) {
      context.addIssue({ code: "custom", path: ["memberPackages"], message: "Member IDs must be unique." });
    }
  });

export async function GET(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const { vaultId: rawVaultId } = await params;
  const parsedVaultId = routeParamSchema.safeParse(rawVaultId);
  if (!parsedVaultId.success) return ApiResponse.json({ error: "invalid_vault_id" }, { status: 400 });
  const snapshot = await getApiRequestContext(request)
    .applicationRuntime.vaultKeyRotation()
    .snapshot(user.id, parsedVaultId.data);
  if (!snapshot) return ApiResponse.json({ error: "rotation_unavailable" }, { status: 404 });
  if (
    snapshot.accounts.length > MAX_ROTATION_ACCOUNTS ||
    snapshot.members.length > MAX_ROTATION_MEMBER_PACKAGES ||
    snapshot.currentKeyVersion === null ||
    snapshot.members.length === 0 ||
    snapshot.members.some(
      (member) =>
        member.keyVersion !== snapshot.currentKeyVersion ||
        !member.publicKey ||
        !publicEncryptionKeySchema.safeParse(member.publicKey).success,
    ) ||
    snapshot.accounts.some((account) => account.encryptedPayload.length > MAX_ENCRYPTED_BLOB_BYTES) ||
    snapshot.encryptedName.length > MAX_ENCRYPTED_BLOB_BYTES
  )
    return ApiResponse.json({ error: "rotation_snapshot_unavailable" }, { status: 409 });

  const response = {
    vaultId: snapshot.vaultId,
    encryptedName: Buffer.from(snapshot.encryptedName).toString("base64"),
    encryptionVersion: snapshot.encryptionVersion,
    currentKeyVersion: snapshot.currentKeyVersion,
    pendingInvitationCount: snapshot.pendingInvitationCount,
    accounts: snapshot.accounts.map((account) => ({
      id: account.id,
      encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"),
      encryptionVersion: account.encryptionVersion,
      revision: account.revision,
      recoverableDeleted: account.deletedAt !== null,
    })),
    members: snapshot.members.map((member) => ({
      userId: member.userId,
      publicKey: member.publicKey,
      keyVersion: member.keyVersion,
    })),
  };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_ROTATION_REQUEST_BYTES)
    return ApiResponse.json({ error: "rotation_snapshot_unavailable" }, { status: 409 });
  return ApiResponse.json(response);
}

export async function PATCH(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "key_material_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, rotationSchema, MAX_ROTATION_REQUEST_BYTES);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_rotation" }, { status: 400 });
  const { vaultId: rawVaultId } = await params;
  const parsedVaultId = routeParamSchema.safeParse(rawVaultId);
  if (!parsedVaultId.success) return ApiResponse.json({ error: "invalid_vault_id" }, { status: 400 });
  const data = parsed.data;
  const rotated = await getApiRequestContext(request)
    .applicationRuntime.vaultKeyRotation()
    .rotate(user.id, parsedVaultId.data, {
      expectedEncryptedName: Buffer.from(data.expectedEncryptedName, "base64"),
      encryptedName: Buffer.from(data.encryptedName, "base64"),
      encryptionVersion: data.encryptionVersion,
      expectedKeyVersion: data.expectedKeyVersion,
      keyVersion: data.keyVersion,
      accounts: data.accounts.map((account) => ({
        id: account.id,
        revision: account.revision,
        encryptedPayload: Buffer.from(account.encryptedPayload, "base64"),
      })),
      memberPackages: data.memberPackages.map((member) => ({
        userId: member.userId,
        expectedPublicKey: member.expectedPublicKey as JsonWebKey,
        encryptedVaultKey: Buffer.from(member.encryptedVaultKey, "base64"),
      })),
    });
  return rotated
    ? new ApiResponse(null, { status: 204 })
    : ApiResponse.json({ error: "rotation_rejected" }, { status: 409 });
}

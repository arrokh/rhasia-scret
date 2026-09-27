import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { Buffer } from "@api/shared/infrastructure/base64";
import { publicEncryptionKeySchema } from "@api/http/public-encryption-key";
import {
  boundedEncryptedBlobSchema,
  MAX_ENCRYPTED_BLOB_BYTES,
  MAX_ROTATION_MEMBER_PACKAGES,
  MAX_ROTATION_REQUEST_BYTES,
  routeParamSchema,
  safeParseJsonBody,
} from "@api/http/validation";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";
import { z } from "zod";

const ciphertext = boundedEncryptedBlobSchema();
const identityRotationSchema = z
  .object({
    expectedPublicKey: publicEncryptionKeySchema,
    expectedEncryptedPrivateKey: ciphertext,
    expectedEncryptionVersion: z.literal(1),
    publicKey: publicEncryptionKeySchema,
    encryptedPrivateKey: ciphertext,
    encryptionVersion: z.literal(1),
    memberships: z
      .array(
        z
          .object({
            vaultId: routeParamSchema,
            expectedKeyVersion: z.number().int().positive(),
            expectedEncryptedVaultKey: ciphertext,
            encryptedVaultKey: ciphertext,
          })
          .strict(),
      )
      .max(MAX_ROTATION_MEMBER_PACKAGES),
  })
  .strict()
  .superRefine(({ memberships }, context) => {
    if (new Set(memberships.map(({ vaultId }) => vaultId)).size !== memberships.length) {
      context.addIssue({ code: "custom", path: ["memberships"], message: "Vault IDs must be unique." });
    }
  });

export async function GET(request: ApiRequest) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const snapshot = await getApiRequestContext(request)
    .applicationRuntime.userEncryptionIdentityRotation()
    .snapshot(user.id);
  if (!snapshot) return ApiResponse.json({ error: "identity_rotation_unavailable" }, { status: 409 });
  if (
    snapshot.encryptionVersion !== 1 ||
    snapshot.encryptedPrivateKey.length > MAX_ENCRYPTED_BLOB_BYTES ||
    snapshot.memberships.length > MAX_ROTATION_MEMBER_PACKAGES ||
    snapshot.memberships.some(
      (membership) =>
        membership.keyVersion < 1 ||
        membership.encryptedVaultKey.length < 13 ||
        membership.encryptedVaultKey.length > MAX_ENCRYPTED_BLOB_BYTES,
    )
  )
    return ApiResponse.json({ error: "identity_rotation_unavailable" }, { status: 409 });
  const publicKey = publicEncryptionKeySchema.safeParse(snapshot.publicKey);
  if (!publicKey.success) return ApiResponse.json({ error: "identity_rotation_unavailable" }, { status: 409 });
  const response = {
    publicKey: publicKey.data,
    encryptedPrivateKey: Buffer.from(snapshot.encryptedPrivateKey).toString("base64"),
    encryptionVersion: snapshot.encryptionVersion,
    memberships: snapshot.memberships.map((membership) => ({
      vaultId: membership.vaultId,
      keyVersion: membership.keyVersion,
      encryptedVaultKey: Buffer.from(membership.encryptedVaultKey).toString("base64"),
    })),
  };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_ROTATION_REQUEST_BYTES)
    return ApiResponse.json({ error: "identity_rotation_unavailable" }, { status: 409 });
  return ApiResponse.json(response);
}

export async function PATCH(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "key_material_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, identityRotationSchema, MAX_ROTATION_REQUEST_BYTES);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_identity_rotation" }, { status: 400 });
  const { data } = parsed;
  const rotated = await getApiRequestContext(request)
    .applicationRuntime.userEncryptionIdentityRotation()
    .rotate(user.id, {
      expectedPublicKey: data.expectedPublicKey as JsonWebKey,
      expectedEncryptedPrivateKey: Buffer.from(data.expectedEncryptedPrivateKey, "base64"),
      expectedEncryptionVersion: data.expectedEncryptionVersion,
      publicKey: data.publicKey as JsonWebKey,
      encryptedPrivateKey: Buffer.from(data.encryptedPrivateKey, "base64"),
      encryptionVersion: data.encryptionVersion,
      memberships: data.memberships.map((membership) => ({
        vaultId: membership.vaultId,
        expectedKeyVersion: membership.expectedKeyVersion,
        expectedEncryptedVaultKey: Buffer.from(membership.expectedEncryptedVaultKey, "base64"),
        encryptedVaultKey: Buffer.from(membership.encryptedVaultKey, "base64"),
      })),
    });
  return rotated
    ? new ApiResponse(null, { status: 204 })
    : ApiResponse.json({ error: "identity_rotation_rejected" }, { status: 409 });
}

import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import {
  boundedEncryptedBlobSchema,
  MAX_ROTATION_ACCOUNTS,
  MAX_ROTATION_MEMBER_PACKAGES,
  MAX_ROTATION_REQUEST_BYTES,
  safeParseJsonBody,
} from "@api/http/validation";
import { z } from "zod";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const ciphertext = boundedEncryptedBlobSchema();
const rotationSchema = z
  .object({
    encryptedName: ciphertext,
    encryptionVersion: z.literal(1),
    keyVersion: z.number().int().positive(),
    accounts: z
      .array(z.object({ id: z.string().min(1).max(128), encryptedPayload: ciphertext }).strict())
      .max(MAX_ROTATION_ACCOUNTS),
    memberPackages: z
      .array(z.object({ userId: z.string().min(1).max(128), encryptedVaultKey: ciphertext }).strict())
      .max(MAX_ROTATION_MEMBER_PACKAGES),
  })
  .strict();

export async function PATCH(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "key_material_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, rotationSchema, MAX_ROTATION_REQUEST_BYTES);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_rotation" }, { status: 400 });
  const { vaultId } = await params;
  const data = parsed.data;
  const rotated = await getApiRequestContext(request)
    .applicationRuntime.vaultKeyRotation()
    .rotate(user.id, vaultId, {
      encryptedName: Buffer.from(data.encryptedName, "base64"),
      encryptionVersion: data.encryptionVersion,
      keyVersion: data.keyVersion,
      accounts: data.accounts.map((account) => ({
        id: account.id,
        encryptedPayload: Buffer.from(account.encryptedPayload, "base64"),
      })),
      memberPackages: data.memberPackages.map((member) => ({
        userId: member.userId,
        encryptedVaultKey: Buffer.from(member.encryptedVaultKey, "base64"),
      })),
    });
  return rotated
    ? new ApiResponse(null, { status: 204 })
    : ApiResponse.json({ error: "rotation_rejected" }, { status: 409 });
}

import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import { createVaultKeyRotationRepository } from "@api/modules/vault-management/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const ciphertext = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const rotationSchema = z.object({
  encryptedName: ciphertext,
  encryptionVersion: z.literal(1),
  keyVersion: z.number().int().positive(),
  accounts: z.array(z.object({ id: z.string().min(1), encryptedPayload: ciphertext })),
  memberPackages: z.array(z.object({ userId: z.string().min(1), encryptedVaultKey: ciphertext })),
});

export async function PATCH(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "key_material_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = rotationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ApiResponse.json({ error: "invalid_rotation" }, { status: 400 });
  const { vaultId } = await params;
  const data = parsed.data;
  const rotated = await createVaultKeyRotationRepository(getApiRequestContext(request).database).rotate(
    user.id,
    vaultId,
    {
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
    },
  );
  return rotated
    ? new ApiResponse(null, { status: 204 })
    : ApiResponse.json({ error: "rotation_rejected" }, { status: 409 });
}

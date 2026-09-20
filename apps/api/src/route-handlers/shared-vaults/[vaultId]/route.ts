import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { createSharedVaultAccessRepository } from "@api/modules/vault-membership/server";
import { createSharedVaultRepository, type SharedVaultRepository } from "@api/modules/vault-management/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const renameSchema = z
  .object({
    encryptedName: boundedEncryptedBlobSchema(),
    encryptionVersion: z.literal(1),
  })
  .strict();

export async function GET(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const { vaultId } = await params;
  const access = await createSharedVaultAccessRepository(getApiRequestContext(request).database).getForMember(
    user.id,
    vaultId,
  );
  if (!access) return ApiResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  return ApiResponse.json({
    vaultId: access.vaultId,
    effectiveAccountPermissions: access.effectiveAccountPermissions,
    encryptedName: Buffer.from(access.encryptedName).toString("base64"),
    encryptionVersion: access.encryptionVersion,
    encryptedVaultKey: Buffer.from(access.encryptedVaultKey).toString("base64"),
    keyVersion: access.keyVersion,
    accounts: access.accounts.map((account) => ({
      id: account.id,
      encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"),
      encryptionVersion: account.encryptionVersion,
      revision: account.revision,
    })),
  });
}

export function createRenameSharedVaultHandler({
  authenticate,
  sharedVaults,
}: {
  authenticate: typeof authenticateApplicationMutation;
  sharedVaults: SharedVaultRepository;
}) {
  return async (request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) => {
    const user = await authenticate(request, "vault_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, renameSchema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_vault_name" }, { status: 400 });
    const { vaultId } = await params;
    const renamed = await sharedVaults.rename(
      user.id,
      vaultId,
      Buffer.from(parsed.data.encryptedName, "base64"),
      parsed.data.encryptionVersion,
    );
    return renamed
      ? new ApiResponse(null, { status: 204 })
      : ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
  };
}

export async function PATCH(request: ApiRequest, context: { params: Promise<{ vaultId: string }> }) {
  return createRenameSharedVaultHandler({
    authenticate: authenticateApplicationMutation,
    sharedVaults: createSharedVaultRepository(getApiRequestContext(request).database),
  })(request, context);
}

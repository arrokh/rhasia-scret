import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { type SharedVaultRepository } from "@api/modules/vault-management/server";
import { type SharedVaultAccessRepository } from "@api/modules/vault-membership/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const blob = boundedEncryptedBlobSchema();
const schema = z
  .object({
    vaultId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,128}$/)
      .optional(),
    encryptedName: blob,
    encryptedOwnerVaultKey: blob,
    encryptionVersion: z.literal(1),
  })
  .strict();
type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  sharedVaults: SharedVaultRepository;
};

export function createSharedVaultHandler({ authenticate, sharedVaults }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "vault_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_vault" }, { status: 400 });
    const vault = await sharedVaults.create(user.id, {
      id: parsed.data.vaultId,
      encryptedName: Buffer.from(parsed.data.encryptedName, "base64"),
      encryptedOwnerVaultKey: Buffer.from(parsed.data.encryptedOwnerVaultKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion,
    });
    return ApiResponse.json({ id: vault.id }, { status: 201 });
  };
}

export function createListSharedVaultsHandler({
  authenticate,
  sharedVaultAccess,
}: {
  authenticate: typeof authenticateApplicationReader;
  sharedVaultAccess: SharedVaultAccessRepository;
}) {
  return async function GET(request: ApiRequest) {
    const user = await authenticate(request, "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const vaults = await sharedVaultAccess.listForMember(user.id);
    return ApiResponse.json(
      vaults.map((vault) => ({
        vaultId: vault.vaultId,
        role: vault.role,
        effectiveAccountPermissions: vault.effectiveAccountPermissions,
        encryptedName: Buffer.from(vault.encryptedName).toString("base64"),
        encryptionVersion: vault.encryptionVersion,
        encryptedVaultKey: Buffer.from(vault.encryptedVaultKey).toString("base64"),
        keyVersion: vault.keyVersion,
        accounts: vault.accounts.map((account) => ({
          id: account.id,
          encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"),
          encryptionVersion: account.encryptionVersion,
          revision: account.revision,
        })),
      })),
    );
  };
}

export async function GET(request: ApiRequest) {
  return createListSharedVaultsHandler({
    authenticate: authenticateApplicationReader,
    sharedVaultAccess: getApiRequestContext(request).applicationRuntime.sharedVaultAccess(),
  })(request);
}

export async function POST(request: ApiRequest) {
  return createSharedVaultHandler({
    authenticate: authenticateApplicationMutation,
    sharedVaults: getApiRequestContext(request).applicationRuntime.sharedVaults(),
  })(request);
}

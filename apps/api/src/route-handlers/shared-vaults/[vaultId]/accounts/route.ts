import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  createSharedAccountRepository,
  type SharedAccountMutationResult,
} from "@api/modules/authenticator-account/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const MAX_ENCRYPTED_ACCOUNT_BYTES = 16 * 1024 + 29;
const encryptedAccountPayload = z.base64().refine((value) => {
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 29 && bytes.length <= MAX_ENCRYPTED_ACCOUNT_BYTES && (bytes[0] === 1 || bytes[0] === 2);
});
const payload = z.object({ encryptedPayload: encryptedAccountPayload, encryptionVersion: z.literal(1) }).strict();
const updateSchema = payload
  .extend({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() })
  .strict();
const deleteSchema = z.object({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict();
const restoreSchema = z.object({ accountId: z.string().min(1) }).strict();

export async function POST(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await authenticateApplicationMutation(request, "account_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = payload.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await createSharedAccountRepository(getApiRequestContext(request).database).create(
      user.id,
      vaultId,
      Buffer.from(parsed.data.encryptedPayload, "base64"),
      parsed.data.encryptionVersion,
    );
    if (result.status !== "SUCCESS") return mutationError(result);
    return ApiResponse.json({ id: result.value.id, revision: result.value.revision }, { status: 201 });
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

export async function PATCH(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await authenticateApplicationMutation(request, "account_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await createSharedAccountRepository(getApiRequestContext(request).database).update(
      user.id,
      vaultId,
      parsed.data.accountId,
      parsed.data.expectedRevision,
      Buffer.from(parsed.data.encryptedPayload, "base64"),
      parsed.data.encryptionVersion,
    );
    if (result.status !== "SUCCESS") return mutationError(result);
    return ApiResponse.json({ id: result.value.id, revision: result.value.revision });
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

export async function DELETE(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await authenticateApplicationMutation(request, "account_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await createSharedAccountRepository(getApiRequestContext(request).database).delete(
      user.id,
      vaultId,
      parsed.data.accountId,
      parsed.data.expectedRevision,
    );
    return result.status === "SUCCESS" ? new ApiResponse(null, { status: 204 }) : mutationError(result);
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

export async function PUT(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await authenticateApplicationMutation(request, "account_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await createSharedAccountRepository(getApiRequestContext(request).database).restore(
      user.id,
      vaultId,
      parsed.data.accountId,
    );
    return result.status === "SUCCESS" ? new ApiResponse(null, { status: 204 }) : mutationError(result);
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

function mutationError(result: Exclude<SharedAccountMutationResult<unknown>, { status: "SUCCESS" }>) {
  if (result.status === "VAULT_UNAVAILABLE") {
    return ApiResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  }
  if (result.status === "PERMISSION_DENIED") {
    return ApiResponse.json({ error: "account_permission_required" }, { status: 403 });
  }
  if (result.status === "STALE_REVISION") {
    return ApiResponse.json({ error: "stale_revision" }, { status: 409 });
  }
  return ApiResponse.json({ error: "account_unavailable" }, { status: 404 });
}

function inactiveOrThrow(error: unknown): ApiResponse {
  throw error;
}

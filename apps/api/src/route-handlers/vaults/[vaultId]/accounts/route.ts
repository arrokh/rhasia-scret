import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  createPersonalAccountRepository,
  type PersonalAccountRepository,
} from "@api/modules/authenticator-account/server";
import type { ApplicationUser, SessionAssurance } from "@api/modules/identity";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const payloadSchema = z.object({
  encryptedPayload: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  encryptionVersion: z.literal(1),
  source: z.literal("LOCAL_VAULT_COPY").optional(),
});
const updateSchema = payloadSchema.extend({
  accountId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
const deleteSchema = z.object({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const restoreSchema = z.object({ accountId: z.string().min(1) });
type ApplicationAuthenticationResult = ApplicationUser | ApiResponse;
type Dependencies = {
  authenticateReader(request: ApiRequest, assurance: SessionAssurance): Promise<ApplicationAuthenticationResult>;
  authenticateMutation(
    request: ApiRequest,
    operation: "account_mutation",
    assurance: SessionAssurance,
  ): Promise<ApplicationAuthenticationResult>;
  accounts: PersonalAccountRepository;
};
type Context = { params: Promise<{ vaultId: string }> };

export function createPersonalAccountsHandlers({ authenticateReader, authenticateMutation, accounts }: Dependencies) {
  async function readAccess(request: ApiRequest) {
    return authenticateReader(request, "fresh-provider-user");
  }

  async function mutationAccess(request: ApiRequest) {
    return authenticateMutation(request, "account_mutation", "fresh-provider-user");
  }
  return {
    GET: async (request: ApiRequest, { params }: Context) => {
      try {
        const current = await readAccess(request);
        if (current instanceof ApiResponse) return current;
        const { vaultId } = await params;
        const list = await accounts.list(current.id, vaultId);
        return ApiResponse.json(
          list.map((account) => ({
            id: account.id,
            encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"),
            encryptionVersion: account.encryptionVersion,
            revision: account.revision,
          })),
        );
      } catch {
        return ApiResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    POST: async (request: ApiRequest, { params }: Context) => {
      try {
        const current = await mutationAccess(request);
        if (current instanceof ApiResponse) return current;
        const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        const account = await accounts.create(current.id, vaultId, {
          encryptedPayload: Buffer.from(parsed.data.encryptedPayload, "base64"),
          encryptionVersion: parsed.data.encryptionVersion,
          source: parsed.data.source,
        });
        return ApiResponse.json({ id: account.id, revision: account.revision }, { status: 201 });
      } catch {
        return ApiResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    PATCH: async (request: ApiRequest, { params }: Context) => {
      try {
        const current = await mutationAccess(request);
        if (current instanceof ApiResponse) return current;
        const parsed = updateSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        const account = await accounts.update(
          current.id,
          vaultId,
          parsed.data.accountId,
          parsed.data.expectedRevision,
          {
            encryptedPayload: Buffer.from(parsed.data.encryptedPayload, "base64"),
            encryptionVersion: parsed.data.encryptionVersion,
          },
        );
        return account
          ? ApiResponse.json({ id: account.id, revision: account.revision })
          : ApiResponse.json({ error: "stale_revision" }, { status: 409 });
      } catch {
        return ApiResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    DELETE: async (request: ApiRequest, { params }: Context) => {
      try {
        const current = await mutationAccess(request);
        if (current instanceof ApiResponse) return current;
        const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        return (await accounts.delete(current.id, vaultId, parsed.data.accountId, parsed.data.expectedRevision))
          ? new ApiResponse(null, { status: 204 })
          : ApiResponse.json({ error: "stale_revision" }, { status: 409 });
      } catch {
        return ApiResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    PUT: async (request: ApiRequest, { params }: Context) => {
      try {
        const current = await mutationAccess(request);
        if (current instanceof ApiResponse) return current;
        const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return ApiResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        return (await accounts.restore(current.id, vaultId, parsed.data.accountId))
          ? new ApiResponse(null, { status: 204 })
          : ApiResponse.json({ error: "account_unavailable" }, { status: 404 });
      } catch {
        return ApiResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
  };
}

function handlersFor(request: ApiRequest) {
  return createPersonalAccountsHandlers({
    authenticateReader: authenticateApplicationReader,
    authenticateMutation: authenticateApplicationMutation,
    accounts: createPersonalAccountRepository(getApiRequestContext(request).database),
  });
}
export const GET = (request: ApiRequest, context: Context) => handlersFor(request).GET(request, context);
export const POST = (request: ApiRequest, context: Context) => handlersFor(request).POST(request, context);
export const PATCH = (request: ApiRequest, context: Context) => handlersFor(request).PATCH(request, context);
export const DELETE = (request: ApiRequest, context: Context) => handlersFor(request).DELETE(request, context);
export const PUT = (request: ApiRequest, context: Context) => handlersFor(request).PUT(request, context);

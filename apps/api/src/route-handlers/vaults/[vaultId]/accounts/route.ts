import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { type PersonalAccountRepository } from "@api/modules/authenticator-account/server";
import type { ApplicationUser, SessionAssurance } from "@api/modules/identity";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const payloadSchema = z
  .object({
    encryptedPayload: boundedEncryptedBlobSchema(),
    encryptionVersion: z.literal(1),
    source: z.literal("LOCAL_VAULT_COPY").optional(),
  })
  .strict();
const updateSchema = payloadSchema
  .extend({
    accountId: z.string().min(1).max(128),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const deleteSchema = z
  .object({ accountId: z.string().min(1).max(128), expectedRevision: z.number().int().positive() })
  .strict();
const restoreSchema = z.object({ accountId: z.string().min(1).max(128) }).strict();
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
        const parsed = await safeParseJsonBody(request, payloadSchema);
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
        const parsed = await safeParseJsonBody(request, updateSchema);
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
        const parsed = await safeParseJsonBody(request, deleteSchema);
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
        const parsed = await safeParseJsonBody(request, restoreSchema);
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
    accounts: getApiRequestContext(request).applicationRuntime.personalAccounts(),
  });
}
export const GET = (request: ApiRequest, context: Context) => handlersFor(request).GET(request, context);
export const POST = (request: ApiRequest, context: Context) => handlersFor(request).POST(request, context);
export const PATCH = (request: ApiRequest, context: Context) => handlersFor(request).PATCH(request, context);
export const DELETE = (request: ApiRequest, context: Context) => handlersFor(request).DELETE(request, context);
export const PUT = (request: ApiRequest, context: Context) => handlersFor(request).PUT(request, context);

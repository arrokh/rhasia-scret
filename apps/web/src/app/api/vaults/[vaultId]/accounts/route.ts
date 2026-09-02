import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createPersonalAccountRepository, type PersonalAccountRepository } from "@/modules/authenticator-account/server";
import type { AuthenticatedApplicationRequest, AuthenticatedApplicationResult } from "@/modules/server-composition";
import { executeAuthenticatedApplicationRequest } from "@/modules/server-composition/server";
import { authenticatedApplicationFailureResponse } from "@/shared/infrastructure/authenticated-application-response";

const payloadSchema = z.object({ encryptedPayload: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13), encryptionVersion: z.literal(1), source: z.literal("LOCAL_VAULT_COPY").optional() });
const updateSchema = payloadSchema.extend({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const deleteSchema = z.object({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const restoreSchema = z.object({ accountId: z.string().min(1) });
type Dependencies = {
  authenticate(request: AuthenticatedApplicationRequest): Promise<AuthenticatedApplicationResult>;
  accounts: PersonalAccountRepository;
};
type Context = { params: Promise<{ vaultId: string }> };

export function createPersonalAccountsHandlers({ authenticate, accounts }: Dependencies) {
  async function access(request: AuthenticatedApplicationRequest) {
    const result = await authenticate(request);
    return result.status === "allowed" ? result.user : authenticatedApplicationFailureResponse(result);
  }
  return {
    GET: async (_request: NextRequest, { params }: Context) => {
      try {
        const current = await access({ assurance: "fresh-provider-user", access: "reader" });
        if (current instanceof NextResponse) return current;
        const { vaultId } = await params;
        const list = await accounts.list(current.id, vaultId);
        return NextResponse.json(list.map((account) => ({ id: account.id, encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"), encryptionVersion: account.encryptionVersion, revision: account.revision })));
      } catch {
        return NextResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    POST: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await access({ assurance: "fresh-provider-user", access: "mutation", operation: "account_mutation" });
        if (current instanceof NextResponse) return current;
        const parsed = payloadSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        const account = await accounts.create(current.id, vaultId, { encryptedPayload: Buffer.from(parsed.data.encryptedPayload, "base64"), encryptionVersion: parsed.data.encryptionVersion, source: parsed.data.source });
        return NextResponse.json({ id: account.id, revision: account.revision }, { status: 201 });
      } catch {
        return NextResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    PATCH: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await access({ assurance: "fresh-provider-user", access: "mutation", operation: "account_mutation" });
        if (current instanceof NextResponse) return current;
        const parsed = updateSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        const account = await accounts.update(current.id, vaultId, parsed.data.accountId, parsed.data.expectedRevision, {
          encryptedPayload: Buffer.from(parsed.data.encryptedPayload, "base64"),
          encryptionVersion: parsed.data.encryptionVersion
        });
        return account ? NextResponse.json({ id: account.id, revision: account.revision }) : NextResponse.json({ error: "stale_revision" }, { status: 409 });
      } catch {
        return NextResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    DELETE: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await access({ assurance: "fresh-provider-user", access: "mutation", operation: "account_mutation" });
        if (current instanceof NextResponse) return current;
        const parsed = deleteSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        return await accounts.delete(current.id, vaultId, parsed.data.accountId, parsed.data.expectedRevision)
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json({ error: "stale_revision" }, { status: 409 });
      } catch {
        return NextResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    },
    PUT: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await access({ assurance: "fresh-provider-user", access: "mutation", operation: "account_mutation" });
        if (current instanceof NextResponse) return current;
        const parsed = restoreSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        return await accounts.restore(current.id, vaultId, parsed.data.accountId)
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json({ error: "account_unavailable" }, { status: 404 });
      } catch {
        return NextResponse.json({ error: "vault_unavailable" }, { status: 404 });
      }
    }
  };
}

const handlers = createPersonalAccountsHandlers({ authenticate: executeAuthenticatedApplicationRequest, accounts: createPersonalAccountRepository() });
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const PUT = handlers.PUT;

import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createPersonalAccountRepository, type PersonalAccountRepository } from "@/modules/authenticator-account/server";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

const payloadSchema = z.object({ encryptedPayload: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13), encryptionVersion: z.literal(1), source: z.literal("LOCAL_VAULT_COPY").optional() });
const updateSchema = payloadSchema.extend({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const deleteSchema = z.object({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const restoreSchema = z.object({ accountId: z.string().min(1) });
type Dependencies = { sessionVerifier: SessionVerifier; applicationUsers: ApplicationUserRepository; accounts: PersonalAccountRepository };
type Context = { params: Promise<{ vaultId: string }> };

export function createPersonalAccountsHandlers({ sessionVerifier, applicationUsers, accounts }: Dependencies) {
  async function user() {
    const current = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!current) return null;
    if (!current.canAccessApplication()) throw new Error("inactive_user");
    return current;
  }
  return {
    GET: async (_request: NextRequest, { params }: Context) => {
      try {
        const current = await user();
        if (!current) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
        const { vaultId } = await params;
        const list = await accounts.list(current.id, vaultId);
        return NextResponse.json(list.map((account) => ({ id: account.id, encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"), encryptionVersion: account.encryptionVersion, revision: account.revision })));
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "vault_unavailable" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
      }
    },
    POST: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await user();
        if (!current) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
        const rateLimited = await rateLimitApplicationUser("account_mutation", current.id);
        if (rateLimited) return rateLimited;
        const parsed = payloadSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        const account = await accounts.create(current.id, vaultId, { encryptedPayload: Buffer.from(parsed.data.encryptedPayload, "base64"), encryptionVersion: parsed.data.encryptionVersion, source: parsed.data.source });
        return NextResponse.json({ id: account.id, revision: account.revision }, { status: 201 });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "vault_unavailable" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
      }
    },
    PATCH: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await user();
        if (!current) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
        const rateLimited = await rateLimitApplicationUser("account_mutation", current.id);
        if (rateLimited) return rateLimited;
        const parsed = updateSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        const account = await accounts.update(current.id, vaultId, parsed.data.accountId, parsed.data.expectedRevision, {
          encryptedPayload: Buffer.from(parsed.data.encryptedPayload, "base64"),
          encryptionVersion: parsed.data.encryptionVersion
        });
        return account ? NextResponse.json({ id: account.id, revision: account.revision }) : NextResponse.json({ error: "stale_revision" }, { status: 409 });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "vault_unavailable" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
      }
    },
    DELETE: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await user();
        if (!current) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
        const rateLimited = await rateLimitApplicationUser("account_mutation", current.id);
        if (rateLimited) return rateLimited;
        const parsed = deleteSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        return await accounts.delete(current.id, vaultId, parsed.data.accountId, parsed.data.expectedRevision)
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json({ error: "stale_revision" }, { status: 409 });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "vault_unavailable" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
      }
    },
    PUT: async (request: NextRequest, { params }: Context) => {
      try {
        const current = await user();
        if (!current) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
        const rateLimited = await rateLimitApplicationUser("account_mutation", current.id);
        if (rateLimited) return rateLimited;
        const parsed = restoreSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
        const { vaultId } = await params;
        return await accounts.restore(current.id, vaultId, parsed.data.accountId)
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json({ error: "account_unavailable" }, { status: 404 });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "vault_unavailable" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
      }
    }
  };
}

const handlers = createPersonalAccountsHandlers({ sessionVerifier: createSessionVerifier(), applicationUsers: createApplicationUserRepository(), accounts: createPersonalAccountRepository() });
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const PUT = handlers.PUT;

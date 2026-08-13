import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import type { SharedAccountMutationResult } from "@/modules/authenticator-account/application/shared-account-repository";
import { PrismaSharedAccountRepository } from "@/modules/authenticator-account/infrastructure/prisma-shared-account-repository";

const MAX_ENCRYPTED_ACCOUNT_BYTES = 16 * 1024 + 29;
const encryptedAccountPayload = z.base64().refine((value) => {
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 29 && bytes.length <= MAX_ENCRYPTED_ACCOUNT_BYTES && (bytes[0] === 1 || bytes[0] === 2);
});
const payload = z.object({ encryptedPayload: encryptedAccountPayload, encryptionVersion: z.literal(1) }).strict();
const updateSchema = payload.extend({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict();
const deleteSchema = z.object({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict();
const restoreSchema = z.object({ accountId: z.string().min(1) }).strict();

async function actor() {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return null;
  if (!user.canAccessApplication()) throw new InactiveUserError();
  return user;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await actor();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const rateLimited = await rateLimitApplicationUser("account_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = payload.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await new PrismaSharedAccountRepository().create(
      user.id,
      vaultId,
      Buffer.from(parsed.data.encryptedPayload, "base64"),
      parsed.data.encryptionVersion
    );
    if (result.status !== "SUCCESS") return mutationError(result);
    return NextResponse.json({ id: result.value.id, revision: result.value.revision }, { status: 201 });
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await actor();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const rateLimited = await rateLimitApplicationUser("account_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await new PrismaSharedAccountRepository().update(
      user.id,
      vaultId,
      parsed.data.accountId,
      parsed.data.expectedRevision,
      Buffer.from(parsed.data.encryptedPayload, "base64"),
      parsed.data.encryptionVersion
    );
    if (result.status !== "SUCCESS") return mutationError(result);
    return NextResponse.json({ id: result.value.id, revision: result.value.revision });
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await actor();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const rateLimited = await rateLimitApplicationUser("account_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await new PrismaSharedAccountRepository().delete(
      user.id,
      vaultId,
      parsed.data.accountId,
      parsed.data.expectedRevision
    );
    return result.status === "SUCCESS" ? new NextResponse(null, { status: 204 }) : mutationError(result);
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await actor();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const rateLimited = await rateLimitApplicationUser("account_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = restoreSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const result = await new PrismaSharedAccountRepository().restore(user.id, vaultId, parsed.data.accountId);
    return result.status === "SUCCESS" ? new NextResponse(null, { status: 204 }) : mutationError(result);
  } catch (error) {
    return inactiveOrThrow(error);
  }
}

function mutationError(result: Exclude<SharedAccountMutationResult<unknown>, { status: "SUCCESS" }>) {
  if (result.status === "VAULT_UNAVAILABLE") {
    return NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  }
  if (result.status === "PERMISSION_DENIED") {
    return NextResponse.json({ error: "account_permission_required" }, { status: 403 });
  }
  if (result.status === "STALE_REVISION") {
    return NextResponse.json({ error: "stale_revision" }, { status: 409 });
  }
  return NextResponse.json({ error: "account_unavailable" }, { status: 404 });
}

function inactiveOrThrow(error: unknown): NextResponse {
  if (error instanceof InactiveUserError) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  throw error;
}

class InactiveUserError extends Error {}

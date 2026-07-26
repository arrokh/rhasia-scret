import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { PrismaSharedOwnerAccountRepository } from "@/modules/authenticator-account/infrastructure/prisma-shared-owner-account-repository";

const payload = z.object({ encryptedPayload: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13), encryptionVersion: z.literal(1) });
const updateSchema = payload.extend({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const deleteSchema = z.object({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });
const restoreSchema = z.object({ accountId: z.string().min(1) });

async function owner() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return null;
  if (!user.canAccessApplication()) throw new Error("inactive_user");
  return user;
}
async function accessError(error: unknown) {
  return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "owner_access_required" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try { const user = await owner(); if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 }); const rateLimited = await rateLimitApplicationUser("account_mutation", user.id); if (rateLimited) return rateLimited; const data = payload.safeParse(await request.json()); if (!data.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 }); const { vaultId } = await params; const account = await new PrismaSharedOwnerAccountRepository().create(user.id, vaultId, Buffer.from(data.data.encryptedPayload, "base64"), data.data.encryptionVersion); return NextResponse.json({ id: account.id, revision: account.revision }, { status: 201 }); } catch (error) { return accessError(error); }
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try { const user = await owner(); if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 }); const rateLimited = await rateLimitApplicationUser("account_mutation", user.id); if (rateLimited) return rateLimited; const data = updateSchema.safeParse(await request.json()); if (!data.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 }); const { vaultId } = await params; const account = await new PrismaSharedOwnerAccountRepository().update(user.id, vaultId, data.data.accountId, data.data.expectedRevision, Buffer.from(data.data.encryptedPayload, "base64"), data.data.encryptionVersion); return account ? NextResponse.json({ id: account.id, revision: account.revision }) : NextResponse.json({ error: "stale_revision" }, { status: 409 }); } catch (error) { return accessError(error); }
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try { const user = await owner(); if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 }); const rateLimited = await rateLimitApplicationUser("account_mutation", user.id); if (rateLimited) return rateLimited; const data = deleteSchema.safeParse(await request.json()); if (!data.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 }); const { vaultId } = await params; return await new PrismaSharedOwnerAccountRepository().delete(user.id, vaultId, data.data.accountId, data.data.expectedRevision) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "stale_revision" }, { status: 409 }); } catch (error) { return accessError(error); }
}
export async function PUT(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try { const user = await owner(); if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 }); const rateLimited = await rateLimitApplicationUser("account_mutation", user.id); if (rateLimited) return rateLimited; const data = restoreSchema.safeParse(await request.json()); if (!data.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 }); const { vaultId } = await params; return await new PrismaSharedOwnerAccountRepository().restore(user.id, vaultId, data.data.accountId) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "account_unavailable" }, { status: 404 }); } catch (error) { return accessError(error); }
}

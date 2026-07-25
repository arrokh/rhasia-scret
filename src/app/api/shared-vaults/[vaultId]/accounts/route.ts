import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { PrismaSharedOwnerAccountRepository } from "@/modules/authenticator-account/infrastructure/prisma-shared-owner-account-repository";

const payload = z.object({ encryptedPayload: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13), encryptionVersion: z.literal(1) });
const updateSchema = payload.extend({ accountId: z.string().min(1), expectedRevision: z.number().int().positive() });

async function owner() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return null;
  if (!user.canAccessApplication()) throw new Error("inactive_user");
  return user;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await owner();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const parsed = payload.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const account = await new PrismaSharedOwnerAccountRepository().create(user.id, vaultId, Buffer.from(parsed.data.encryptedPayload, "base64"), parsed.data.encryptionVersion);
    return NextResponse.json({ id: account.id, revision: account.revision }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "owner_access_required" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  try {
    const user = await owner();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    const { vaultId } = await params;
    const account = await new PrismaSharedOwnerAccountRepository().update(user.id, vaultId, parsed.data.accountId, parsed.data.expectedRevision, Buffer.from(parsed.data.encryptedPayload, "base64"), parsed.data.encryptionVersion);
    if (!account) return NextResponse.json({ error: "stale_revision" }, { status: 409 });
    return NextResponse.json({ id: account.id, revision: account.revision });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "inactive_user" ? "inactive_user" : "owner_access_required" }, { status: error instanceof Error && error.message === "inactive_user" ? 403 : 404 });
  }
}

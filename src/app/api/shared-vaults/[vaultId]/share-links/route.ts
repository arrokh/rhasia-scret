import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { PrismaSecureShareLinkRepository } from "@/modules/vault-membership/infrastructure/prisma-secure-share-link-repository";

const schema = z.object({ recipientUserId: z.string().min(1), linkVerifier: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32), encryptedPackage: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_share_link" }, { status: 400 });
  try {
    const { vaultId } = await params;
    const link = await new PrismaSecureShareLinkRepository().create(user.id, vaultId, { recipientUserId: parsed.data.recipientUserId, linkVerifier: Buffer.from(parsed.data.linkVerifier, "base64"), encryptedPackage: Buffer.from(parsed.data.encryptedPackage, "base64") });
    return NextResponse.json({ id: link.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  }
}

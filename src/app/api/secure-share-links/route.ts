import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { PrismaSecureShareLinkRepository } from "@/modules/vault-membership/infrastructure/prisma-secure-share-link-repository";

const verifier = z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32);
const redeemSchema = z.object({ invitationId: z.string().min(1), encryptedVaultKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13), keyVersion: z.literal(1) });

export async function GET(request: NextRequest) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = verifier.safeParse(request.nextUrl.searchParams.get("verifier"));
  if (!parsed.success) return NextResponse.json({ error: "invalid_share_link" }, { status: 400 });
  const link = await new PrismaSecureShareLinkRepository().findForRecipient(user.id, Buffer.from(parsed.data, "base64"));
  if (!link) return NextResponse.json({ error: "share_link_unavailable" }, { status: 404 });
  return NextResponse.json({ id: link.id, vaultId: link.vaultId, encryptedPackage: Buffer.from(link.encryptedPackage).toString("base64") });
}

export async function POST(request: NextRequest) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = redeemSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_redemption" }, { status: 400 });
  try {
    await new PrismaSecureShareLinkRepository().redeem(user.id, parsed.data.invitationId, Buffer.from(parsed.data.encryptedVaultKey, "base64"), parsed.data.keyVersion);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "share_link_unavailable" }, { status: 404 });
  }
}

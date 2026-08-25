import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { createSecureShareLinkInvitation, createSecureShareLinkRepository, InvitationConflictError, InvitationRecipientUnavailableError } from "@/modules/vault-membership/server";

const schema = z.object({ recipientEmail: z.email(), linkVerifier: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32), encryptedPackage: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_share_link" }, { status: 400 });
  try {
    const { vaultId } = await params;
    const link = await createSecureShareLinkInvitation(user.id, vaultId, parsed.data.recipientEmail, { linkVerifier: Buffer.from(parsed.data.linkVerifier, "base64"), encryptedPackage: Buffer.from(parsed.data.encryptedPackage, "base64") }, createSecureShareLinkRepository());
    return NextResponse.json({ id: link.id, expiresAt: link.expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    if (error instanceof InvitationRecipientUnavailableError) return NextResponse.json({ error: "shared_vault_or_recipient_unavailable" }, { status: 404 });
    if (error instanceof InvitationConflictError) return NextResponse.json({ error: "invitation_conflict" }, { status: 409 });
    throw error;
  }
}

import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createSecureShareLinkRepository,
  findSecureShareLinkForRecipient,
  redeemSecureShareLinkForRecipient,
  SecureShareLinkUnavailableError,
} from "@/modules/vault-membership/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@/shared/infrastructure/authenticated-application-request";

const verifier = z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32);
const redeemSchema = z.object({
  invitationId: z.string().min(1),
  encryptedVaultKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  keyVersion: z.literal(1),
});

export async function GET(request: NextRequest) {
  const user = await authenticateApplicationReader("fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const parsed = verifier.safeParse(request.nextUrl.searchParams.get("verifier"));
  if (!parsed.success) return NextResponse.json({ error: "invalid_share_link" }, { status: 400 });
  const link = await findSecureShareLinkForRecipient(
    { userId: user.id, email: user.email },
    Buffer.from(parsed.data, "base64"),
    createSecureShareLinkRepository(),
  );
  if (!link) return NextResponse.json({ error: "share_link_unavailable" }, { status: 404 });
  return NextResponse.json({
    id: link.id,
    vaultId: link.vaultId,
    encryptedPackage: Buffer.from(link.encryptedPackage).toString("base64"),
  });
}

export async function POST(request: NextRequest) {
  const user = await authenticateApplicationMutation("membership_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const parsed = redeemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_redemption" }, { status: 400 });
  try {
    await redeemSecureShareLinkForRecipient(
      { userId: user.id, email: user.email },
      parsed.data.invitationId,
      Buffer.from(parsed.data.encryptedVaultKey, "base64"),
      parsed.data.keyVersion,
      createSecureShareLinkRepository(),
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof SecureShareLinkUnavailableError)
      return NextResponse.json({ error: "share_link_unavailable" }, { status: 404 });
    throw error;
  }
}

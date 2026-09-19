import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  createSecureShareLinkInvitation,
  createSecureShareLinkRepository,
  InvitationConflictError,
  InvitationRecipientUnavailableError,
} from "@api/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const schema = z.object({
  recipientEmail: z.email(),
  linkVerifier: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32),
  encryptedPackage: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
});

export async function POST(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ApiResponse.json({ error: "invalid_share_link" }, { status: 400 });
  try {
    const { vaultId } = await params;
    const link = await createSecureShareLinkInvitation(
      user.id,
      vaultId,
      parsed.data.recipientEmail,
      {
        linkVerifier: Buffer.from(parsed.data.linkVerifier, "base64"),
        encryptedPackage: Buffer.from(parsed.data.encryptedPackage, "base64"),
      },
      createSecureShareLinkRepository(getApiRequestContext(request).database),
    );
    return ApiResponse.json({ id: link.id, expiresAt: link.expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    if (error instanceof InvitationRecipientUnavailableError)
      return ApiResponse.json({ error: "shared_vault_or_recipient_unavailable" }, { status: 404 });
    if (error instanceof InvitationConflictError)
      return ApiResponse.json({ error: "invitation_conflict" }, { status: 409 });
    throw error;
  }
}

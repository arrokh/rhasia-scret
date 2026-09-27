import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import {
  createSecureShareLinkInvitation,
  InvitationConflictError,
  InvitationRecipientUnavailableError,
  MAX_INVITATION_RECIPIENT_EMAIL_LENGTH,
} from "@api/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const schema = z
  .object({
    recipientEmail: z.string().trim().min(1).max(MAX_INVITATION_RECIPIENT_EMAIL_LENGTH).email(),
    linkVerifier: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32),
    encryptedPackage: boundedEncryptedBlobSchema(),
    expectedKeyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export async function POST(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, schema);
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
        expectedKeyVersion: parsed.data.expectedKeyVersion,
      },
      getApiRequestContext(request).applicationRuntime.secureShareLinks(),
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

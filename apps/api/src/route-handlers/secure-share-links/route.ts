import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import {
  findSecureShareLinkForRecipient,
  redeemSecureShareLinkForRecipient,
  SecureShareLinkUnavailableError,
} from "@api/modules/vault-membership/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const verifier = z.base64().refine((value) => Buffer.byteLength(value, "base64") === 32);
const redeemSchema = z
  .object({
    invitationId: z.string().min(1).max(128),
    encryptedVaultKey: boundedEncryptedBlobSchema(),
    keyVersion: z.literal(1),
  })
  .strict();

export async function GET(request: ApiRequest) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = verifier.safeParse(request.nextUrl.searchParams.get("verifier"));
  if (!parsed.success) return ApiResponse.json({ error: "invalid_share_link" }, { status: 400 });
  const link = await findSecureShareLinkForRecipient(
    { userId: user.id, email: user.email },
    Buffer.from(parsed.data, "base64"),
    getApiRequestContext(request).applicationRuntime.secureShareLinks(),
  );
  if (!link) return ApiResponse.json({ error: "share_link_unavailable" }, { status: 404 });
  return ApiResponse.json({
    id: link.id,
    vaultId: link.vaultId,
    encryptedPackage: Buffer.from(link.encryptedPackage).toString("base64"),
  });
}

export async function POST(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, redeemSchema);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_redemption" }, { status: 400 });
  try {
    await redeemSecureShareLinkForRecipient(
      { userId: user.id, email: user.email },
      parsed.data.invitationId,
      Buffer.from(parsed.data.encryptedVaultKey, "base64"),
      parsed.data.keyVersion,
      getApiRequestContext(request).applicationRuntime.secureShareLinks(),
    );
    return new ApiResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof SecureShareLinkUnavailableError)
      return ApiResponse.json({ error: "share_link_unavailable" }, { status: 404 });
    throw error;
  }
}

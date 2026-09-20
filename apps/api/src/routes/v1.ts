import type { Handler, Hono } from "hono";
import type { ApiEnvironment } from "@api/types";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { apiFactory } from "@api/http/hono-factory";
import { routeParamsSchema } from "@api/http/validation";
import { appendSetCookies } from "@api/http/cookies";
import { DELETE as deleteMe, GET as getMe } from "@api/route-handlers/me/route";
import { POST as requestMagicLink } from "@api/route-handlers/auth/magic-link/request/route";
import { POST as redeemMagicLink } from "@api/route-handlers/auth/magic-link/redeem/route";
import { POST as pwaSession } from "@api/route-handlers/auth/pwa/session/route";
import { POST as refreshSession } from "@api/route-handlers/auth/session/refresh/route";
import { POST as revokeSession } from "@api/route-handlers/auth/session/revoke/route";
import { GET as retentionPurge } from "@api/route-handlers/internal/retention-purge/route";
import { GET as deletionPreview } from "@api/route-handlers/me/deletion/preview/route";
import { POST as startOidcDeletion } from "@api/route-handlers/me/deletion/oidc/start/route";
import { POST as completeOidcDeletion } from "@api/route-handlers/me/deletion/oidc/complete/route";
import { POST as requestDeletionOtp } from "@api/route-handlers/me/deletion/otp/request/route";
import { POST as verifyDeletionOtp } from "@api/route-handlers/me/deletion/otp/verify/route";
import { DELETE as removePasskey } from "@api/route-handlers/passkey-recovery/route";
import { GET as passkeyStatus } from "@api/route-handlers/passkey-recovery/status/route";
import { POST as authenticationOptions } from "@api/route-handlers/passkey-recovery/authentication/options/route";
import { POST as authenticationVerify } from "@api/route-handlers/passkey-recovery/authentication/verify/route";
import { POST as registrationOptions } from "@api/route-handlers/passkey-recovery/registration/options/route";
import { POST as registrationVerify } from "@api/route-handlers/passkey-recovery/registration/verify/route";
import { GET as getPersonalVault } from "@api/route-handlers/personal-vault/route";
import { POST as initializePersonalVault } from "@api/route-handlers/personal-vault/initialize/route";
import {
  GET as getDestructiveResetEligibility,
  POST as resetPersonalVault,
} from "@api/route-handlers/personal-vault/destructive-reset/route";
import { GET as getSecureShareLinks, POST as postSecureShareLinks } from "@api/route-handlers/secure-share-links/route";
import { GET as listSharedVaults, POST as createSharedVault } from "@api/route-handlers/shared-vaults/route";
import { GET as getSharedVault, PATCH as renameSharedVault } from "@api/route-handlers/shared-vaults/[vaultId]/route";
import { GET as sharedParticipants } from "@api/route-handlers/shared-vaults/[vaultId]/participants/route";
import {
  GET as sharedPermissions,
  PATCH as updateSharedPermissions,
} from "@api/route-handlers/shared-vaults/[vaultId]/member-permissions/route";
import {
  POST as sharedAccountsPost,
  PATCH as sharedAccountsPatch,
  DELETE as sharedAccountsDelete,
  PUT as sharedAccountsRestore,
} from "@api/route-handlers/shared-vaults/[vaultId]/accounts/route";
import { POST as leaveSharedVault } from "@api/route-handlers/shared-vaults/[vaultId]/leave/route";
import {
  DELETE as deleteSharedVault,
  POST as restoreSharedVault,
} from "@api/route-handlers/shared-vaults/[vaultId]/lifecycle/route";
import { PATCH as rotateSharedVault } from "@api/route-handlers/shared-vaults/[vaultId]/rotation/route";
import { POST as inviteSharedVault } from "@api/route-handlers/shared-vaults/[vaultId]/share-links/route";
import { DELETE as cancelSharedInvitation } from "@api/route-handlers/shared-vaults/[vaultId]/share-links/[invitationId]/route";
import {
  PATCH as updateMemberPermissions,
  DELETE as deleteSharedMember,
} from "@api/route-handlers/shared-vaults/[vaultId]/members/[userId]/route";
import { POST as recordSharedAudit } from "@api/route-handlers/shared-vaults/[vaultId]/audit-events/route";
import {
  GET as getVaultAudit,
  POST as recordVaultAudit,
} from "@api/route-handlers/vaults/[vaultId]/audit-events/route";
import {
  GET as personalAccountsGet,
  POST as personalAccountsPost,
  PATCH as personalAccountsPatch,
  DELETE as personalAccountsDelete,
  PUT as personalAccountsRestore,
} from "@api/route-handlers/vaults/[vaultId]/accounts/route";
import { POST as recordArchiveExport } from "@api/route-handlers/vaults/[vaultId]/archive-exports/route";
import { GET as getOfflineBundle } from "@api/route-handlers/sync/offline-bundle/route";
import { GET as getCryptoProfile } from "@api/route-handlers/user-crypto-profile/route";
import { POST as rewrapCryptoProfile } from "@api/route-handlers/user-crypto-profile/rewrap/route";
import { PUT as putEncryptionIdentity } from "@api/route-handlers/user-encryption-identity/route";
import { POST as importVault } from "@api/route-handlers/vault-imports/route";

type HandlerContext<Params extends Record<string, string>> = { params: Promise<Params> };

const v1Routes = apiFactory
  .createApp()
  .get("/me", adapt(getMe))
  .delete("/me", adapt(deleteMe))
  .post("/auth/magic-link/request", adapt(requestMagicLink))
  .post("/auth/magic-link/redeem", adapt(redeemMagicLink))
  .post("/auth/pwa/session", adapt(pwaSession))
  .post("/auth/session/refresh", adapt(refreshSession))
  .post("/auth/session/revoke", adapt(revokeSession))
  .get("/internal/retention-purge", adapt(retentionPurge))
  .get("/me/deletion/preview", adapt(deletionPreview))
  .post("/me/deletion/oidc/start", adapt(startOidcDeletion))
  .post("/me/deletion/oidc/complete", adapt(completeOidcDeletion))
  .post("/me/deletion/otp/request", adapt(requestDeletionOtp))
  .post("/me/deletion/otp/verify", adapt(verifyDeletionOtp))
  .delete("/passkey-recovery", adapt(removePasskey))
  .get("/passkey-recovery/status", adapt(passkeyStatus))
  .post("/passkey-recovery/authentication/options", adapt(authenticationOptions))
  .post("/passkey-recovery/authentication/verify", adapt(authenticationVerify))
  .post("/passkey-recovery/registration/options", adapt(registrationOptions))
  .post("/passkey-recovery/registration/verify", adapt(registrationVerify))
  .get("/personal-vault", adapt(getPersonalVault))
  .post("/personal-vault/initialize", adapt(initializePersonalVault))
  .get("/personal-vault/destructive-reset", adapt(getDestructiveResetEligibility))
  .post("/personal-vault/destructive-reset", adapt(resetPersonalVault))
  .get("/secure-share-links", adapt(getSecureShareLinks))
  .post("/secure-share-links", adapt(postSecureShareLinks))
  .get("/shared-vaults", adapt(listSharedVaults))
  .post("/shared-vaults", adapt(createSharedVault))
  .get("/shared-vaults/:vaultId", adapt(getSharedVault))
  .patch("/shared-vaults/:vaultId", adapt(renameSharedVault))
  .get("/shared-vaults/:vaultId/participants", adapt(sharedParticipants))
  .get("/shared-vaults/:vaultId/member-permissions", adapt(sharedPermissions))
  .patch("/shared-vaults/:vaultId/member-permissions", adapt(updateSharedPermissions))
  .post("/shared-vaults/:vaultId/accounts", adapt(sharedAccountsPost))
  .patch("/shared-vaults/:vaultId/accounts", adapt(sharedAccountsPatch))
  .delete("/shared-vaults/:vaultId/accounts", adapt(sharedAccountsDelete))
  .put("/shared-vaults/:vaultId/accounts", adapt(sharedAccountsRestore))
  .post("/shared-vaults/:vaultId/leave", adapt(leaveSharedVault))
  .delete("/shared-vaults/:vaultId/lifecycle", adapt(deleteSharedVault))
  .post("/shared-vaults/:vaultId/lifecycle", adapt(restoreSharedVault))
  .patch("/shared-vaults/:vaultId/rotation", adapt(rotateSharedVault))
  .post("/shared-vaults/:vaultId/share-links", adapt(inviteSharedVault))
  .delete("/shared-vaults/:vaultId/share-links/:invitationId", adapt(cancelSharedInvitation))
  .patch("/shared-vaults/:vaultId/members/:userId", adapt(updateMemberPermissions))
  .delete("/shared-vaults/:vaultId/members/:userId", adapt(deleteSharedMember))
  .get("/shared-vaults/:vaultId/audit-events", adapt(getVaultAudit))
  .post("/shared-vaults/:vaultId/audit-events", adapt(recordSharedAudit))
  .get("/vaults/:vaultId/audit-events", adapt(getVaultAudit))
  .post("/vaults/:vaultId/audit-events", adapt(recordVaultAudit))
  .get("/vaults/:vaultId/accounts", adapt(personalAccountsGet))
  .post("/vaults/:vaultId/accounts", adapt(personalAccountsPost))
  .patch("/vaults/:vaultId/accounts", adapt(personalAccountsPatch))
  .delete("/vaults/:vaultId/accounts", adapt(personalAccountsDelete))
  .put("/vaults/:vaultId/accounts", adapt(personalAccountsRestore))
  .post("/vaults/:vaultId/archive-exports", adapt(recordArchiveExport))
  .get("/sync/offline-bundle", adapt(getOfflineBundle))
  .get("/user-crypto-profile", adapt(getCryptoProfile))
  .post("/user-crypto-profile/rewrap", adapt(rewrapCryptoProfile))
  .put("/user-encryption-identity", adapt(putEncryptionIdentity))
  .post("/vault-imports", adapt(importVault));

export function registerV1Routes(app: Hono<ApiEnvironment>): void {
  app.route("", v1Routes);
}

function adapt<Params extends Record<string, string>>(
  handler: (request: ApiRequest, context: HandlerContext<Params>) => Response | Promise<Response>,
): Handler<ApiEnvironment> {
  return async (context) => {
    const request = context.get("apiRequest");
    const parsedParams = routeParamsSchema.safeParse(context.req.param());
    if (!parsedParams.success) return ApiResponse.json({ error: "invalid_request" }, { status: 400 });
    const params = parsedParams.data as unknown as Params;
    const response = await handler(request, { params: Promise.resolve(params) });
    return response instanceof ApiResponse ? appendSetCookies(response, response.cookies) : response;
  };
}

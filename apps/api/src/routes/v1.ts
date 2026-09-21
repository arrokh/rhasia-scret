import type { Hono } from "hono";
import type { ApiEnvironment } from "@api/types";
import { apiFactory } from "@api/http/hono-factory";
import { registerLazyRoute, type LazyApiRouteMethod } from "@api/routes/route-adapter";

type LazyRouteDefinition = Readonly<{
  method: LazyApiRouteMethod;
  path: string;
  load: () => Promise<unknown>;
}>;

const routes: readonly LazyRouteDefinition[] = [
  { method: "get", path: "/me", load: () => import("@api/route-handlers/me/route") },
  { method: "delete", path: "/me", load: () => import("@api/route-handlers/me/route") },
  {
    method: "post",
    path: "/auth/magic-link/request",
    load: () => import("@api/route-handlers/auth/magic-link/request/route"),
  },
  {
    method: "post",
    path: "/auth/magic-link/redeem",
    load: () => import("@api/route-handlers/auth/magic-link/redeem/route"),
  },
  { method: "post", path: "/auth/pwa/session", load: () => import("@api/route-handlers/auth/pwa/session/route") },
  {
    method: "post",
    path: "/auth/session/refresh",
    load: () => import("@api/route-handlers/auth/session/refresh/route"),
  },
  {
    method: "post",
    path: "/auth/session/revoke",
    load: () => import("@api/route-handlers/auth/session/revoke/route"),
  },
  {
    method: "get",
    path: "/internal/retention-purge",
    load: () => import("@api/route-handlers/internal/retention-purge/route"),
  },
  {
    method: "get",
    path: "/me/deletion/preview",
    load: () => import("@api/route-handlers/me/deletion/preview/route"),
  },
  {
    method: "post",
    path: "/me/deletion/oidc/start",
    load: () => import("@api/route-handlers/me/deletion/oidc/start/route"),
  },
  {
    method: "post",
    path: "/me/deletion/oidc/complete",
    load: () => import("@api/route-handlers/me/deletion/oidc/complete/route"),
  },
  {
    method: "post",
    path: "/me/deletion/otp/request",
    load: () => import("@api/route-handlers/me/deletion/otp/request/route"),
  },
  {
    method: "post",
    path: "/me/deletion/otp/verify",
    load: () => import("@api/route-handlers/me/deletion/otp/verify/route"),
  },
  {
    method: "delete",
    path: "/passkey-recovery",
    load: () => import("@api/route-handlers/passkey-recovery/route"),
  },
  {
    method: "get",
    path: "/passkey-recovery/status",
    load: () => import("@api/route-handlers/passkey-recovery/status/route"),
  },
  {
    method: "post",
    path: "/passkey-recovery/authentication/options",
    load: () => import("@api/route-handlers/passkey-recovery/authentication/options/route"),
  },
  {
    method: "post",
    path: "/passkey-recovery/authentication/verify",
    load: () => import("@api/route-handlers/passkey-recovery/authentication/verify/route"),
  },
  {
    method: "post",
    path: "/passkey-recovery/registration/options",
    load: () => import("@api/route-handlers/passkey-recovery/registration/options/route"),
  },
  {
    method: "post",
    path: "/passkey-recovery/registration/verify",
    load: () => import("@api/route-handlers/passkey-recovery/registration/verify/route"),
  },
  { method: "get", path: "/personal-vault", load: () => import("@api/route-handlers/personal-vault/route") },
  {
    method: "post",
    path: "/personal-vault/initialize",
    load: () => import("@api/route-handlers/personal-vault/initialize/route"),
  },
  {
    method: "get",
    path: "/personal-vault/destructive-reset",
    load: () => import("@api/route-handlers/personal-vault/destructive-reset/route"),
  },
  {
    method: "post",
    path: "/personal-vault/destructive-reset",
    load: () => import("@api/route-handlers/personal-vault/destructive-reset/route"),
  },
  {
    method: "get",
    path: "/secure-share-links",
    load: () => import("@api/route-handlers/secure-share-links/route"),
  },
  {
    method: "post",
    path: "/secure-share-links",
    load: () => import("@api/route-handlers/secure-share-links/route"),
  },
  { method: "get", path: "/shared-vaults", load: () => import("@api/route-handlers/shared-vaults/route") },
  { method: "post", path: "/shared-vaults", load: () => import("@api/route-handlers/shared-vaults/route") },
  {
    method: "get",
    path: "/shared-vaults/:vaultId",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/route"),
  },
  {
    method: "patch",
    path: "/shared-vaults/:vaultId",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/route"),
  },
  {
    method: "get",
    path: "/shared-vaults/:vaultId/participants",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/participants/route"),
  },
  {
    method: "get",
    path: "/shared-vaults/:vaultId/member-permissions",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/member-permissions/route"),
  },
  {
    method: "patch",
    path: "/shared-vaults/:vaultId/member-permissions",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/member-permissions/route"),
  },
  {
    method: "post",
    path: "/shared-vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/accounts/route"),
  },
  {
    method: "patch",
    path: "/shared-vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/accounts/route"),
  },
  {
    method: "delete",
    path: "/shared-vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/accounts/route"),
  },
  {
    method: "put",
    path: "/shared-vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/accounts/route"),
  },
  {
    method: "post",
    path: "/shared-vaults/:vaultId/leave",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/leave/route"),
  },
  {
    method: "delete",
    path: "/shared-vaults/:vaultId/lifecycle",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/lifecycle/route"),
  },
  {
    method: "post",
    path: "/shared-vaults/:vaultId/lifecycle",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/lifecycle/route"),
  },
  {
    method: "patch",
    path: "/shared-vaults/:vaultId/rotation",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/rotation/route"),
  },
  {
    method: "post",
    path: "/shared-vaults/:vaultId/share-links",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/share-links/route"),
  },
  {
    method: "delete",
    path: "/shared-vaults/:vaultId/share-links/:invitationId",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/share-links/[invitationId]/route"),
  },
  {
    method: "patch",
    path: "/shared-vaults/:vaultId/members/:userId",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/members/[userId]/route"),
  },
  {
    method: "delete",
    path: "/shared-vaults/:vaultId/members/:userId",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/members/[userId]/route"),
  },
  {
    method: "get",
    path: "/shared-vaults/:vaultId/audit-events",
    load: () => import("@api/route-handlers/vaults/[vaultId]/audit-events/route"),
  },
  {
    method: "post",
    path: "/shared-vaults/:vaultId/audit-events",
    load: () => import("@api/route-handlers/shared-vaults/[vaultId]/audit-events/route"),
  },
  {
    method: "get",
    path: "/vaults/:vaultId/audit-events",
    load: () => import("@api/route-handlers/vaults/[vaultId]/audit-events/route"),
  },
  {
    method: "post",
    path: "/vaults/:vaultId/audit-events",
    load: () => import("@api/route-handlers/vaults/[vaultId]/audit-events/route"),
  },
  {
    method: "get",
    path: "/vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/vaults/[vaultId]/accounts/route"),
  },
  {
    method: "post",
    path: "/vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/vaults/[vaultId]/accounts/route"),
  },
  {
    method: "patch",
    path: "/vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/vaults/[vaultId]/accounts/route"),
  },
  {
    method: "delete",
    path: "/vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/vaults/[vaultId]/accounts/route"),
  },
  {
    method: "put",
    path: "/vaults/:vaultId/accounts",
    load: () => import("@api/route-handlers/vaults/[vaultId]/accounts/route"),
  },
  {
    method: "post",
    path: "/vaults/:vaultId/archive-exports",
    load: () => import("@api/route-handlers/vaults/[vaultId]/archive-exports/route"),
  },
  { method: "get", path: "/sync/offline-bundle", load: () => import("@api/route-handlers/sync/offline-bundle/route") },
  {
    method: "get",
    path: "/user-crypto-profile",
    load: () => import("@api/route-handlers/user-crypto-profile/route"),
  },
  {
    method: "post",
    path: "/user-crypto-profile/rewrap",
    load: () => import("@api/route-handlers/user-crypto-profile/rewrap/route"),
  },
  {
    method: "put",
    path: "/user-encryption-identity",
    load: () => import("@api/route-handlers/user-encryption-identity/route"),
  },
  { method: "post", path: "/vault-imports", load: () => import("@api/route-handlers/vault-imports/route") },
];

const v1Routes = apiFactory.createApp();
for (const route of routes) registerLazyRoute(v1Routes, route.method, route.path, route.load);

export function registerV1Routes(app: Hono<ApiEnvironment>): void {
  app.route("", v1Routes);
}

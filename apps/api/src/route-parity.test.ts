import { describe, expect, it } from "vitest";
import { createApiApp } from "@api/app";
import { createDisabledEmailSenders } from "@api/smtp-email-senders";
import { API_ROUTE_MANIFEST } from "@rhasia-scret/api-contract";
import type { ApiBindings } from "@api/types";

const app = createApiApp();

const bindings: ApiBindings = {
  WEB_ORIGIN: "https://rhasia-scret.nooroctavian.id",
  PROXY_SECRET: "proxy-secret-that-is-long-enough-for-tests-123456",
  EMAIL_SENDERS: createDisabledEmailSenders(),
};

const routes: ReadonlyArray<readonly [string, string]> = [
  ["POST", "/v1/auth/magic-link/request"],
  ["POST", "/v1/auth/magic-link/redeem"],
  ["POST", "/v1/auth/pwa/session"],
  ["POST", "/v1/auth/session/refresh"],
  ["POST", "/v1/auth/session/revoke"],
  ["GET", "/v1/health"],
  ["GET", "/v1/time"],
  ["GET", "/v1/internal/retention-purge"],
  ["GET", "/v1/me"],
  ["DELETE", "/v1/me"],
  ["GET", "/v1/me/deletion/preview"],
  ["POST", "/v1/me/deletion/oidc/start"],
  ["POST", "/v1/me/deletion/oidc/complete"],
  ["POST", "/v1/me/deletion/otp/request"],
  ["POST", "/v1/me/deletion/otp/verify"],
  ["POST", "/v1/passkey-recovery/registration/options"],
  ["POST", "/v1/passkey-recovery/registration/verify"],
  ["POST", "/v1/passkey-recovery/authentication/options"],
  ["POST", "/v1/passkey-recovery/authentication/verify"],
  ["GET", "/v1/passkey-recovery/status"],
  ["DELETE", "/v1/passkey-recovery"],
  ["GET", "/v1/personal-vault"],
  ["POST", "/v1/personal-vault/initialize"],
  ["GET", "/v1/personal-vault/destructive-reset"],
  ["POST", "/v1/personal-vault/destructive-reset"],
  ["GET", "/v1/user-crypto-profile"],
  ["POST", "/v1/user-crypto-profile/rewrap"],
  ["PUT", "/v1/user-encryption-identity"],
  ["POST", "/v1/vault-imports"],
  ["GET", "/v1/shared-vaults"],
  ["POST", "/v1/shared-vaults"],
  ["GET", "/v1/shared-vaults/vault_1"],
  ["PATCH", "/v1/shared-vaults/vault_1"],
  ["POST", "/v1/shared-vaults/vault_1/accounts"],
  ["PATCH", "/v1/shared-vaults/vault_1/accounts"],
  ["DELETE", "/v1/shared-vaults/vault_1/accounts"],
  ["PUT", "/v1/shared-vaults/vault_1/accounts"],
  ["GET", "/v1/shared-vaults/vault_1/audit-events"],
  ["POST", "/v1/shared-vaults/vault_1/audit-events"],
  ["POST", "/v1/shared-vaults/vault_1/leave"],
  ["DELETE", "/v1/shared-vaults/vault_1/lifecycle"],
  ["POST", "/v1/shared-vaults/vault_1/lifecycle"],
  ["GET", "/v1/shared-vaults/vault_1/member-permissions"],
  ["PATCH", "/v1/shared-vaults/vault_1/member-permissions"],
  ["PATCH", "/v1/shared-vaults/vault_1/members/user_1"],
  ["DELETE", "/v1/shared-vaults/vault_1/members/user_1"],
  ["GET", "/v1/shared-vaults/vault_1/participants"],
  ["PATCH", "/v1/shared-vaults/vault_1/rotation"],
  ["POST", "/v1/shared-vaults/vault_1/share-links"],
  ["DELETE", "/v1/shared-vaults/vault_1/share-links/invitation_1"],
  ["GET", "/v1/secure-share-links"],
  ["POST", "/v1/secure-share-links"],
  ["GET", "/v1/vaults/vault_1/accounts"],
  ["POST", "/v1/vaults/vault_1/accounts"],
  ["PATCH", "/v1/vaults/vault_1/accounts"],
  ["DELETE", "/v1/vaults/vault_1/accounts"],
  ["PUT", "/v1/vaults/vault_1/accounts"],
  ["POST", "/v1/vaults/vault_1/archive-exports"],
  ["GET", "/v1/vaults/vault_1/audit-events"],
  ["POST", "/v1/vaults/vault_1/audit-events"],
  ["GET", "/v1/sync/offline-bundle"],
];

describe("canonical API route parity", () => {
  it("covers every registered operation, including deletion and dynamic aliases", () => {
    expect(routes).toHaveLength(61);
    expect(new Set(routes.map(([method, path]) => `${method} ${path}`)).size).toBe(61);
    expect(routes).toEqual(API_ROUTE_MANIFEST.map(([method, path]) => [method, materialize(path)]));
  });

  it.each(routes)("registers %s %s only at /v1", async (method, path) => {
    const response = await app.request(`https://api.example.test${path}`, { method }, bindings);
    expect(response.status).not.toBe(404);
    const unversioned = await app.request(
      `https://api.example.test${path.replace("/v1/", "/api/")}`,
      { method },
      bindings,
    );
    expect(unversioned.status).toBe(404);
  });

  it.each(routes)(
    "exercises the %s %s boundary without a database or authenticated principal",
    async (method, path) => {
      const response = await app.request(
        `https://api.example.test${path}`,
        {
          method,
          headers: { origin: bindings.WEB_ORIGIN as string, "content-type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        },
        {
          ...bindings,
          AUTH_BACKEND: "none",
          AUTH_MAGIC_LINK_SECRET: "boundary-test-magic-secret-12345678901234567890",
          AUTH_SESSION_SECRET: "boundary-test-session-secret-12345678901234567890",
          SMTP_HOST: "127.0.0.1",
          SMTP_PORT: "2525",
          SMTP_SECURE: "false",
          SMTP_REQUIRE_TLS: "true",
          SMTP_USER: "boundary-test-smtp-user",
          SMTP_PASSWORD: "boundary-test-smtp-password",
          AUTH_EMAIL_FROM: "no-reply@boundary.test",
          DATABASE_CLIENT: {} as NonNullable<ApiBindings["DATABASE_CLIENT"]>,
        },
      );
      expect(response.status).toBe(expectedBoundaryStatus(method, path));
    },
  );

  it("provides Hono HEAD behavior for public system routes", async () => {
    for (const path of ["/v1/health", "/v1/time"]) {
      const response = await app.request(`https://api.example.test${path}`, { method: "HEAD" }, bindings);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    }
  });
});

function materialize(path: string): string {
  return `/v1${path}`
    .replace(":vaultId", "vault_1")
    .replace(":userId", "user_1")
    .replace(":invitationId", "invitation_1");
}

function expectedBoundaryStatus(method: string, path: string): number {
  if (path === "/v1/health" || path === "/v1/time") return 200;
  if (path === "/v1/internal/retention-purge") return 503;
  if (
    path === "/v1/auth/magic-link/request" ||
    path === "/v1/auth/magic-link/redeem" ||
    path === "/v1/auth/pwa/session"
  )
    return 400;
  if (path === "/v1/auth/session/refresh") return 400;
  if (path === "/v1/auth/session/revoke") return 204;
  if (
    path === "/v1/me/deletion/oidc/start" ||
    path === "/v1/me/deletion/oidc/complete" ||
    path === "/v1/me/deletion/otp/request"
  )
    return 409;
  return 401;
}

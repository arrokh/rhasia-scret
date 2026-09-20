import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponse } from "@api/http/api-request";
import { apiTestRequest } from "@api/tests/support/api-request";

const mocks = vi.hoisted(() => ({
  authenticateReader: vi.fn(),
  authenticateMutation: vi.fn(),
  sharedAccounts: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), restore: vi.fn() },
  sharedVaultAccess: { getForMember: vi.fn() },
  sharedVaults: { create: vi.fn(), rename: vi.fn() },
  lifecycle: { delete: vi.fn(), restore: vi.fn() },
  participantRepository: {},
  listParticipants: vi.fn(),
  cancelInvitation: vi.fn(),
  permissionRepository: {},
  loadDefaults: vi.fn(),
  updateDefaults: vi.fn(),
  updateOverrides: vi.fn(),
  leave: vi.fn(),
  revoke: vi.fn(),
  rotate: vi.fn(),
  secureLinks: {},
  findLink: vi.fn(),
  redeemLink: vi.fn(),
  createLink: vi.fn(),
  listAudit: vi.fn(),
  recordSharedAccess: vi.fn(),
  InvitationConflictError: class extends Error {},
  InvitationRecipientUnavailableError: class extends Error {},
  SecureShareLinkUnavailableError: class extends Error {},
  MAX_INVITATION_RECIPIENT_EMAIL_LENGTH: 254,
  MembershipUnavailableError: class extends Error {},
}));

vi.mock("@api/shared/infrastructure/authenticated-application-request", () => ({
  authenticateApplicationReader: mocks.authenticateReader,
  authenticateApplicationMutation: mocks.authenticateMutation,
}));
vi.mock("@api/modules/authenticator-account/server", () => ({
  createSharedAccountRepository: () => mocks.sharedAccounts,
}));
vi.mock("@api/modules/vault-membership/server", () => ({
  createSharedVaultAccessRepository: () => mocks.sharedVaultAccess,
  createVaultParticipantRepository: () => mocks.participantRepository,
  listVaultParticipantsForOwner: mocks.listParticipants,
  cancelPendingVaultInvitation: mocks.cancelInvitation,
  createSharedVaultAccountPermissionRepository: () => mocks.permissionRepository,
  loadSharedVaultMemberPermissionDefaults: mocks.loadDefaults,
  updateSharedVaultMemberPermissionDefaults: mocks.updateDefaults,
  updateSharedVaultMemberPermissionOverrides: mocks.updateOverrides,
  createMembershipLifecycleRepository: () => ({ leave: mocks.leave, revoke: mocks.revoke }),
  leaveVaultMembership: mocks.leave,
  revokeVaultMembership: mocks.revoke,
  MembershipUnavailableError: mocks.MembershipUnavailableError,
  createVaultKeyRotationRepository: () => ({ rotate: mocks.rotate }),
  createSecureShareLinkRepository: () => mocks.secureLinks,
  findSecureShareLinkForRecipient: mocks.findLink,
  redeemSecureShareLinkForRecipient: mocks.redeemLink,
  createSecureShareLinkInvitation: mocks.createLink,
  InvitationConflictError: mocks.InvitationConflictError,
  InvitationRecipientUnavailableError: mocks.InvitationRecipientUnavailableError,
  SecureShareLinkUnavailableError: mocks.SecureShareLinkUnavailableError,
  MAX_INVITATION_RECIPIENT_EMAIL_LENGTH: mocks.MAX_INVITATION_RECIPIENT_EMAIL_LENGTH,
  parseVaultParticipantCursorKey: (key: string) => (key.startsWith("member:") ? key : null),
}));
vi.mock("@api/modules/vault-management/server", () => ({
  createSharedVaultRepository: () => mocks.sharedVaults,
  createSharedVaultRecoveryRepository: () => mocks.lifecycle,
  createVaultKeyRotationRepository: () => ({ rotate: mocks.rotate }),
}));
vi.mock("@api/modules/audit/server", () => ({
  createVaultAuditRepository: () => ({ listForOwner: mocks.listAudit, recordAccountAccess: mocks.recordSharedAccess }),
  listVaultAuditForOwner: mocks.listAudit,
  recordSharedVaultAccountAccess: mocks.recordSharedAccess,
}));

import {
  POST as sharedAccountPost,
  PATCH as sharedAccountPatch,
  DELETE as sharedAccountDelete,
  PUT as sharedAccountRestore,
} from "@api/route-handlers/shared-vaults/[vaultId]/accounts/route";
import { GET as sharedVaultGet, PATCH as sharedVaultPatch } from "@api/route-handlers/shared-vaults/[vaultId]/route";
import { GET as participantGet } from "@api/route-handlers/shared-vaults/[vaultId]/participants/route";
import {
  GET as permissionGet,
  PATCH as permissionPatch,
} from "@api/route-handlers/shared-vaults/[vaultId]/member-permissions/route";
import {
  PATCH as memberPatch,
  DELETE as memberDelete,
} from "@api/route-handlers/shared-vaults/[vaultId]/members/[userId]/route";
import {
  DELETE as lifecycleDelete,
  POST as lifecycleRestore,
} from "@api/route-handlers/shared-vaults/[vaultId]/lifecycle/route";
import { POST as leave } from "@api/route-handlers/shared-vaults/[vaultId]/leave/route";
import { PATCH as rotate } from "@api/route-handlers/shared-vaults/[vaultId]/rotation/route";
import { POST as invite } from "@api/route-handlers/shared-vaults/[vaultId]/share-links/route";
import { DELETE as cancel } from "@api/route-handlers/shared-vaults/[vaultId]/share-links/[invitationId]/route";
import { GET as secureLinkGet, POST as secureLinkPost } from "@api/route-handlers/secure-share-links/route";
import { GET as sharedAuditGet } from "@api/route-handlers/vaults/[vaultId]/audit-events/route";
import { POST as sharedAuditPost } from "@api/route-handlers/shared-vaults/[vaultId]/audit-events/route";

const user = { id: "owner-1", email: "owner@example.test" };
const owner = user;
const accountPayload = { encryptedPayload: Buffer.alloc(29, 1).toString("base64"), encryptionVersion: 1 };
const params = { params: Promise.resolve({ vaultId: "vault-1" }) };
const request = (path: string, init: RequestInit = {}) => apiTestRequest(path, init);

beforeEach(() => {
  mocks.authenticateReader.mockResolvedValue(user);
  mocks.authenticateMutation.mockResolvedValue(user);
});

afterEach(() => vi.clearAllMocks());

describe("Shared Vault account and lifecycle routes", () => {
  it("creates, updates, soft-deletes, and restores opaque accounts with revision mapping", async () => {
    mocks.sharedAccounts.create.mockResolvedValue({ status: "SUCCESS", value: { id: "account-1", revision: 1 } });
    const created = await sharedAccountPost(
      request("/v1/shared-vaults/vault-1/accounts", { method: "POST", body: JSON.stringify(accountPayload) }),
      params,
    );
    expect(created.status).toBe(201);
    expect(mocks.sharedAccounts.create).toHaveBeenCalledWith("owner-1", "vault-1", expect.any(Uint8Array), 1);

    mocks.sharedAccounts.update.mockResolvedValue({ status: "STALE_REVISION" });
    const updated = await sharedAccountPatch(
      request("/v1/shared-vaults/vault-1/accounts", {
        method: "PATCH",
        body: JSON.stringify({ ...accountPayload, accountId: "account-1", expectedRevision: 1 }),
      }),
      params,
    );
    expect(updated.status).toBe(409);
    await expect(updated.json()).resolves.toEqual({ error: "stale_revision" });

    mocks.sharedAccounts.delete.mockResolvedValue({ status: "SUCCESS" });
    expect(
      (
        await sharedAccountDelete(
          request("/v1/shared-vaults/vault-1/accounts", {
            method: "DELETE",
            body: JSON.stringify({ accountId: "account-1", expectedRevision: 2 }),
          }),
          params,
        )
      ).status,
    ).toBe(204);
    mocks.sharedAccounts.restore.mockResolvedValue({ status: "SUCCESS" });
    expect(
      (
        await sharedAccountRestore(
          request("/v1/shared-vaults/vault-1/accounts", {
            method: "PUT",
            body: JSON.stringify({ accountId: "account-1" }),
          }),
          params,
        )
      ).status,
    ).toBe(204);
  });

  it("maps shared-account permission and availability outcomes without exposing Vault data", async () => {
    mocks.sharedAccounts.create
      .mockResolvedValueOnce({ status: "PERMISSION_DENIED" })
      .mockResolvedValueOnce({ status: "VAULT_UNAVAILABLE" });
    const denied = await sharedAccountPost(
      request("/v1/shared-vaults/vault-1/accounts", { method: "POST", body: JSON.stringify(accountPayload) }),
      params,
    );
    const unavailable = await sharedAccountPost(
      request("/v1/shared-vaults/vault-1/accounts", { method: "POST", body: JSON.stringify(accountPayload) }),
      params,
    );
    expect(denied.status).toBe(403);
    expect(unavailable.status).toBe(404);
    expect(await unavailable.text()).not.toContain("encrypted");
  });

  it("reads and renames only authorized encrypted Shared Vault material", async () => {
    mocks.sharedVaultAccess.getForMember.mockResolvedValue({
      vaultId: "vault-1",
      effectiveAccountPermissions: { permissions: {}, sources: {} },
      encryptedName: Uint8Array.of(1, 2, 3),
      encryptionVersion: 1,
      encryptedVaultKey: Uint8Array.of(4, 5, 6),
      keyVersion: 1,
      accounts: [],
    });
    const response = await sharedVaultGet(request("/v1/shared-vaults/vault-1"), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      vaultId: "vault-1",
      encryptedName: "AQID",
      encryptedVaultKey: "BAUG",
    });

    mocks.sharedVaults.rename.mockResolvedValue(true);
    const renamed = await sharedVaultPatch(
      request("/v1/shared-vaults/vault-1", {
        method: "PATCH",
        body: JSON.stringify({ encryptedName: Buffer.alloc(13, 2).toString("base64"), encryptionVersion: 1 }),
      }),
      params,
    );
    expect(renamed.status).toBe(204);
    expect(mocks.sharedVaults.rename).toHaveBeenCalledWith("owner-1", "vault-1", expect.any(Uint8Array), 1);
  });

  it("deletes, restores, and leaves a Shared Vault through the lifecycle repository", async () => {
    mocks.lifecycle.delete.mockResolvedValue(true);
    mocks.lifecycle.restore.mockResolvedValue(true);
    mocks.leave.mockResolvedValue(undefined);
    expect(
      (await lifecycleDelete(request("/v1/shared-vaults/vault-1/lifecycle", { method: "DELETE" }), params)).status,
    ).toBe(204);
    expect(
      (await lifecycleRestore(request("/v1/shared-vaults/vault-1/lifecycle", { method: "POST" }), params)).status,
    ).toBe(204);
    expect((await leave(request("/v1/shared-vaults/vault-1/leave", { method: "POST" }), params)).status).toBe(204);
  });
});

describe("Shared Vault membership and permission routes", () => {
  it("returns participant metadata with a cursor and rejects malformed cursor scope", async () => {
    mocks.listParticipants.mockResolvedValue({
      owner: user,
      vaultDefaultAccountPermissions: { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false },
      vaultDefaultAccountPermissionsRevision: 2,
      items: [],
      nextCursor: null,
    });
    const response = await participantGet(request("/v1/shared-vaults/vault-1/participants"), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ owner, participants: [], nextCursor: null });
    const invalid = await participantGet(request("/v1/shared-vaults/vault-1/participants?cursor=bad"), params);
    expect(invalid.status).toBe(400);
  });

  it("reads and revision-protects Vault defaults and member overrides", async () => {
    const permissions = { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: true };
    mocks.loadDefaults.mockResolvedValue({ permissions, revision: 2 });
    await expect(permissionGet(request("/v1/shared-vaults/vault-1/member-permissions"), params)).resolves.toMatchObject(
      { status: 200 },
    );
    mocks.updateDefaults.mockResolvedValue({ status: "STALE" });
    const stale = await permissionPatch(
      request("/v1/shared-vaults/vault-1/member-permissions", {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: 2, ...permissions }),
      }),
      params,
    );
    expect(stale.status).toBe(409);

    mocks.updateOverrides.mockResolvedValue({
      status: "UPDATED",
      value: {
        overrides: { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: false },
        effective: { permissions, sources: {} },
        revision: 3,
      },
    });
    const member = await memberPatch(
      request("/v1/shared-vaults/vault-1/members/user-1", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: 2,
          canAddAccounts: null,
          canEditAccounts: true,
          canDeleteAccounts: false,
        }),
      }),
      { params: Promise.resolve({ vaultId: "vault-1", userId: "user-1" }) },
    );
    expect(member.status).toBe(200);
    expect(mocks.updateOverrides).toHaveBeenCalledWith(
      "owner-1",
      "vault-1",
      "user-1",
      2,
      expect.any(Object),
      expect.anything(),
    );
  });

  it("revokes members and cancels only owner-scoped invitations", async () => {
    mocks.revoke.mockResolvedValue(undefined);
    expect(
      (
        await memberDelete(request("/v1/shared-vaults/vault-1/members/user-1", { method: "DELETE" }), {
          params: Promise.resolve({ vaultId: "vault-1", userId: "user-1" }),
        })
      ).status,
    ).toBe(204);
    mocks.cancelInvitation.mockResolvedValue(true);
    expect(
      (
        await cancel(request("/v1/shared-vaults/vault-1/share-links/invitation-1", { method: "DELETE" }), {
          params: Promise.resolve({ vaultId: "vault-1", invitationId: "invitation-1" }),
        })
      ).status,
    ).toBe(204);
    expect(mocks.cancelInvitation).toHaveBeenCalledWith("owner-1", "vault-1", "invitation-1", expect.anything());
  });

  it("rejects rotations with more than the bounded item count", async () => {
    const body = {
      encryptedName: Buffer.alloc(13, 1).toString("base64"),
      encryptionVersion: 1,
      keyVersion: 2,
      accounts: Array.from({ length: 501 }, (_, index) => ({
        id: `account-${index}`,
        encryptedPayload: Buffer.alloc(13, 2).toString("base64"),
      })),
      memberPackages: [],
    };
    const response = await rotate(
      request("/v1/shared-vaults/vault-1/rotation", { method: "PATCH", body: JSON.stringify(body) }),
      params,
    );
    expect(response.status).toBe(400);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it("rotates encrypted member packages without returning key material", async () => {
    mocks.rotate.mockResolvedValue(true);
    const body = {
      encryptedName: Buffer.alloc(13, 1).toString("base64"),
      encryptionVersion: 1,
      keyVersion: 2,
      accounts: [{ id: "account-1", encryptedPayload: Buffer.alloc(13, 2).toString("base64") }],
      memberPackages: [{ userId: "member-1", encryptedVaultKey: Buffer.alloc(13, 3).toString("base64") }],
    };
    const response = await rotate(
      request("/v1/shared-vaults/vault-1/rotation", { method: "PATCH", body: JSON.stringify(body) }),
      params,
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});

describe("Secure Share Link routes", () => {
  it("rejects an overlong recipient email before persistence", async () => {
    const response = await invite(
      request("/v1/shared-vaults/vault-1/share-links", {
        method: "POST",
        body: JSON.stringify({
          recipientEmail: `${"a".repeat(250)}@example.test`,
          linkVerifier: Buffer.alloc(32, 1).toString("base64"),
          encryptedPackage: Buffer.alloc(13, 2).toString("base64"),
        }),
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  it("creates, resolves, and redeems a link using only recipient identity and encrypted bytes", async () => {
    mocks.createLink.mockResolvedValue({ id: "invitation-1", expiresAt: new Date("2026-09-16T00:00:00.000Z") });
    const created = await invite(
      request("/v1/shared-vaults/vault-1/share-links", {
        method: "POST",
        body: JSON.stringify({
          recipientEmail: "viewer@example.test",
          linkVerifier: Buffer.alloc(32, 1).toString("base64"),
          encryptedPackage: Buffer.alloc(13, 2).toString("base64"),
        }),
      }),
      params,
    );
    expect(created.status).toBe(201);
    expect(mocks.createLink).toHaveBeenCalledWith(
      "owner-1",
      "vault-1",
      "viewer@example.test",
      expect.objectContaining({ linkVerifier: expect.anything() }),
      expect.anything(),
    );

    mocks.findLink.mockResolvedValue({
      id: "invitation-1",
      vaultId: "vault-1",
      encryptedPackage: Uint8Array.of(2, 3, 4),
    });
    const found = await secureLinkGet(
      request(`/v1/secure-share-links?verifier=${Buffer.alloc(32, 1).toString("base64")}`),
    );
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({ id: "invitation-1", vaultId: "vault-1", encryptedPackage: "AgME" });

    mocks.redeemLink.mockResolvedValue(undefined);
    const redeemed = await secureLinkPost(
      request("/v1/secure-share-links", {
        method: "POST",
        body: JSON.stringify({
          invitationId: "invitation-1",
          encryptedVaultKey: Buffer.alloc(13, 3).toString("base64"),
          keyVersion: 1,
        }),
      }),
    );
    expect(redeemed.status).toBe(204);
  });

  it("maps one-time link conflict/unavailability without exposing repository failures", async () => {
    mocks.createLink.mockRejectedValueOnce(new mocks.InvitationConflictError("duplicate"));
    expect(
      (
        await invite(
          request("/v1/shared-vaults/vault-1/share-links", {
            method: "POST",
            body: JSON.stringify({
              recipientEmail: "viewer@example.test",
              linkVerifier: Buffer.alloc(32).toString("base64"),
              encryptedPackage: Buffer.alloc(13).toString("base64"),
            }),
          }),
          params,
        )
      ).status,
    ).toBe(409);
    mocks.redeemLink.mockRejectedValueOnce(new mocks.SecureShareLinkUnavailableError("expired"));
    const response = await secureLinkPost(
      request("/v1/secure-share-links", {
        method: "POST",
        body: JSON.stringify({
          invitationId: "invitation-1",
          encryptedVaultKey: Buffer.alloc(13).toString("base64"),
          keyVersion: 1,
        }),
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe("Shared Vault audit routes", () => {
  it("records only an opaque account-access event and returns redacted owner events", async () => {
    mocks.recordSharedAccess.mockResolvedValue(true);
    expect(
      (
        await sharedAuditPost(
          request("/v1/shared-vaults/vault-1/audit-events", {
            method: "POST",
            body: JSON.stringify({ eventType: "ACCOUNT_ACCESSED", accountId: "account-1" }),
          }),
          params,
        )
      ).status,
    ).toBe(204);
    mocks.listAudit.mockResolvedValue({ items: [], nextCursor: null });
    const response = await sharedAuditGet(request("/v1/shared-vaults/vault-1/audit-events"), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ events: [], nextCursor: null });
  });

  it("does not mutate a route after authentication failure", async () => {
    mocks.authenticateMutation.mockResolvedValue(ApiResponse.json({ error: "unauthenticated" }, { status: 401 }));
    const response = await sharedAccountPost(
      request("/v1/shared-vaults/vault-1/accounts", { method: "POST", body: "not-json" }),
      params,
    );
    expect(response.status).toBe(401);
    expect(mocks.sharedAccounts.create).not.toHaveBeenCalled();
  });
});

import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createDeleteMeHandler } from "@/app/api/me/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import type { AccountDeletionEmailSender } from "@/modules/account-deletion/application/account-deletion-email";
import type { AccountDeletionRepository } from "@/modules/account-deletion/application/account-deletion-repository";

const cookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

const user = new ApplicationUser("user-1", "rhasia:passwordless", "subject-1", "person@example.test", "ACTIVE");

function request(body: unknown, token = "a".repeat(43), requestOrigin?: string): NextRequest {
  cookieStore.get.mockImplementation((name: string) =>
    name === "rhsia-account-deletion-authorization" ? { value: token } : undefined,
  );
  const configuredOrigin =
    process.env.AUTH_BACKEND === "oidc" ? process.env.OIDC_REDIRECT_URI : process.env.AUTH_APP_ORIGIN;
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : "http://localhost";
  return new NextRequest(`${origin}/api/me`, {
    method: "DELETE",
    headers: { origin: requestOrigin ?? origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handler(
  overrides: Partial<{
    repository: Partial<AccountDeletionRepository>;
    sender: Pick<AccountDeletionEmailSender, "sendDeletionCompletionEmail">;
  }> = {},
) {
  const repository = {
    findCompletedDeletion: vi.fn().mockResolvedValue(null),
    deleteUser: vi.fn().mockResolvedValue({
      receiptId: "receipt-1",
      email: user.email,
      authBackend: "passwordless",
      personalVaultCount: 1,
      sharedVaultDeletedCount: 0,
      sharedVaultTransferredCount: 0,
      authenticatorAccountCount: 0,
    }),
    recordCompletionEmailStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides.repository,
  } as unknown as AccountDeletionRepository;
  const sender = overrides.sender ?? { sendDeletionCompletionEmail: vi.fn().mockResolvedValue(undefined) };
  return {
    repository,
    sender,
    handler: createDeleteMeHandler({
      authenticateMutation: async () => user,
      repository,
      sender,
      terminateSession: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    }),
  };
}

describe("DELETE /api/me account deletion contract", () => {
  it("requires a same-origin browser authorization cookie", async () => {
    const { handler: deleteHandler } = handler();
    const response = await deleteHandler(request({}, ""));
    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin browser mutation before authentication or deletion", async () => {
    const test = handler();
    const response = await test.handler(request({}, "a".repeat(43), "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(test.repository.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects invalid confirmation before invoking permanent deletion", async () => {
    const test = handler({ repository: { deleteUser: vi.fn().mockRejectedValue(new Error("invalid_confirmation")) } });
    const response = await test.handler(request({ confirmation: "delete me", acknowledged: true, vaultDecisions: [] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_confirmation" });
    expect(test.repository.deleteUser).toHaveBeenCalledOnce();
  });

  it("deletes the account and sends only the opaque receipt to completion email", async () => {
    const test = handler();
    const response = await test.handler(
      request({ confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ receiptId: "receipt-1", emailDelivery: "sent" });
    expect(test.sender.sendDeletionCompletionEmail).toHaveBeenCalledOnce();
    expect(test.sender.sendDeletionCompletionEmail).toHaveBeenCalledWith({
      recipientEmail: user.email,
      receiptId: "receipt-1",
    });
    expect(test.repository.deleteUser).toHaveBeenCalledWith(
      "user-1",
      "a".repeat(43),
      "passwordless",
      { confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] },
      new Date("2026-09-15T00:00:00.000Z"),
    );
  });

  it("returns a committed receipt on a retry without authenticating a deleted user", async () => {
    const repository = {
      findCompletedDeletion: vi.fn().mockResolvedValue({ receiptId: "receipt-1", emailDeliveryStatus: "SENT" }),
      deleteUser: vi.fn(),
    } as unknown as Partial<AccountDeletionRepository>;
    const test = handler({ repository });
    const authenticateMutation = vi.fn(async () =>
      NextResponse.json({ error: "should_not_authenticate" }, { status: 401 }),
    );
    const retryHandler = createDeleteMeHandler({
      authenticateMutation,
      repository: test.repository,
      sender: { sendDeletionCompletionEmail: vi.fn() },
      terminateSession: vi.fn(),
      now: () => new Date(),
    });
    const response = await retryHandler(
      request({ confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ receiptId: "receipt-1", emailDelivery: "sent" });
    expect(authenticateMutation).not.toHaveBeenCalled();
  });
});

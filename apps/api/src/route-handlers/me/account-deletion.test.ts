import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createDeleteMeHandler } from "./route";
import type { AccountDeletionEmailSender } from "@api/modules/account-deletion/application/account-deletion-email";
import type { AccountDeletionRepository } from "@api/modules/account-deletion/application/account-deletion-repository";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";

const user = new ApplicationUser("user_1", "rhasia:passwordless", "subject_1", "person@example.test", "ACTIVE");
const token = "a".repeat(43);

function request(body: unknown, requestOrigin = "https://web.example.test"): ApiRequest {
  return new ApiRequest("https://api.example.test/v1/me", {
    method: "DELETE",
    headers: {
      origin: requestOrigin,
      "x-rhasia-expected-origin": "https://web.example.test",
      cookie: `rhsia-account-deletion-authorization=${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function setup(overrides: Partial<AccountDeletionRepository> = {}) {
  const repository = {
    findCompletedDeletion: vi.fn().mockResolvedValue(null),
    deleteUser: vi.fn().mockResolvedValue({
      receiptId: "receipt_1",
      email: user.email,
      authBackend: "passwordless",
      personalVaultCount: 1,
      sharedVaultDeletedCount: 0,
      sharedVaultTransferredCount: 0,
      authenticatorAccountCount: 0,
    }),
    recordCompletionEmailStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AccountDeletionRepository;
  const sender: Pick<AccountDeletionEmailSender, "sendDeletionCompletionEmail"> = {
    sendDeletionCompletionEmail: vi.fn().mockResolvedValue(undefined),
  };
  const handler = createDeleteMeHandler({
    authenticateMutation: vi.fn(async () => user),
    repository,
    sender,
    terminateSession: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-09-15T00:00:00.000Z"),
  });
  return { handler, repository, sender };
}

describe("DELETE /v1/me account deletion contract", () => {
  it("rejects a cross-origin mutation before authentication or deletion", async () => {
    const test = setup();
    const response = await test.handler(request({}, "https://attacker.example.test"));
    expect(response.status).toBe(403);
    expect(test.repository.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the account and sends only the opaque receipt to email", async () => {
    const test = setup();
    const response = await test.handler(
      request({ confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ receiptId: "receipt_1", emailDelivery: "sent" });
    expect(test.sender.sendDeletionCompletionEmail).toHaveBeenCalledWith({
      recipientEmail: user.email,
      receiptId: "receipt_1",
    });
    expect(test.repository.deleteUser).toHaveBeenCalledWith(
      "user_1",
      token,
      "passwordless",
      { confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] },
      new Date("2026-09-15T00:00:00.000Z"),
    );
    expect(response.cookies.getAll().join("\n")).toContain("rhsia-account-deletion-authorization");
  });

  it("returns an existing receipt idempotently without authenticating a deleted user", async () => {
    const repository = {
      findCompletedDeletion: vi.fn().mockResolvedValue({ receiptId: "receipt_1", emailDeliveryStatus: "SENT" }),
      deleteUser: vi.fn(),
    } as unknown as AccountDeletionRepository;
    const authenticateMutation = vi.fn(async () =>
      ApiResponse.json({ error: "should_not_authenticate" }, { status: 401 }),
    );
    const handler = createDeleteMeHandler({
      authenticateMutation,
      repository,
      sender: { sendDeletionCompletionEmail: vi.fn() },
      terminateSession: vi.fn(),
      now: () => new Date(),
    });

    const response = await handler(request({ confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ receiptId: "receipt_1", emailDelivery: "sent" });
    expect(authenticateMutation).not.toHaveBeenCalled();
  });
});

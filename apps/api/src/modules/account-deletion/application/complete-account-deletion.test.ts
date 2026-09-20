import { describe, expect, it, vi } from "vitest";
import { completeAccountDeletion, type CompleteAccountDeletionDependencies } from "./complete-account-deletion";

const request = {
  confirmation: "HAPUS DATA BRANKAS",
  acknowledged: true,
  vaultDecisions: [],
} as const;

const deletion = {
  receiptId: "receipt-1",
  email: "person@example.test",
  authBackend: "passwordless" as const,
  personalVaultCount: 1,
  sharedVaultDeletedCount: 0,
  sharedVaultTransferredCount: 0,
  authenticatorAccountCount: 1,
};

function makeDependencies() {
  return {
    repository: {
      deleteUser: vi.fn().mockResolvedValue(deletion),
      recordCompletionEmailStatus: vi.fn().mockResolvedValue(undefined),
    },
    sender: { sendDeletionCompletionEmail: vi.fn().mockResolvedValue(undefined) },
    applicationUserId: "user-1",
    authorizationToken: "authorization-token",
    authBackend: "passwordless" as const,
    request,
    now: new Date("2026-09-21T00:00:00.000Z"),
  };
}

describe("completeAccountDeletion", () => {
  it("persists sent status after the committed deletion", async () => {
    const dependencies = makeDependencies();
    const result = await completeAccountDeletion(dependencies as unknown as CompleteAccountDeletionDependencies);

    expect(result).toEqual({ deletion, emailDelivery: "sent" });
    expect(dependencies.repository.deleteUser).toHaveBeenCalledWith(
      "user-1",
      "authorization-token",
      "passwordless",
      request,
      dependencies.now,
    );
    expect(dependencies.repository.recordCompletionEmailStatus).toHaveBeenCalledWith("receipt-1", "SENT");
  });

  it("returns failure without undoing the committed deletion", async () => {
    const dependencies = makeDependencies();
    dependencies.sender.sendDeletionCompletionEmail.mockRejectedValue(new Error("smtp unavailable"));

    await expect(
      completeAccountDeletion(dependencies as unknown as CompleteAccountDeletionDependencies),
    ).resolves.toEqual({ deletion, emailDelivery: "failed" });
    expect(dependencies.repository.recordCompletionEmailStatus).toHaveBeenCalledWith("receipt-1", "FAILED");
  });
});

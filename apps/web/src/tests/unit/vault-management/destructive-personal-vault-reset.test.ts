import { describe, expect, it, vi } from "vitest";
import {
  DESTRUCTIVE_RESET_CONFIRMATION,
  InvalidDestructiveResetConfirmationError,
  destructivelyResetPersonalVault,
} from "@/modules/vault-management/application/destructive-personal-vault-reset";

describe("destructivelyResetPersonalVault", () => {
  it("requires the exact destructive confirmation before invoking the repository", async () => {
    const reset = vi.fn();

    await expect(
      destructivelyResetPersonalVault("user-1", "hapus data brankas", {
        getEligibility: vi.fn(),
        reset,
      }),
    ).rejects.toBeInstanceOf(InvalidDestructiveResetConfirmationError);
    expect(reset).not.toHaveBeenCalled();
  });

  it("executes the reset for the confirmed application user", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);

    await destructivelyResetPersonalVault("user-1", DESTRUCTIVE_RESET_CONFIRMATION, {
      getEligibility: vi.fn(),
      reset,
    });

    expect(reset).toHaveBeenCalledWith("user-1");
  });
});

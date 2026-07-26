import { describe, expect, it, vi } from "vitest";
import { signOutCurrentSession } from "@/modules/identity/application/session-terminator";

describe("signOutCurrentSession", () => {
  it("terminates the current authenticated session", async () => {
    const terminateCurrentSession = vi.fn().mockResolvedValue(undefined);

    await expect(signOutCurrentSession({ terminateCurrentSession })).resolves.toBeUndefined();
    expect(terminateCurrentSession).toHaveBeenCalledOnce();
  });

  it("propagates termination failures", async () => {
    const failure = new Error("logout failed");
    const terminateCurrentSession = vi.fn().mockRejectedValue(failure);

    await expect(signOutCurrentSession({ terminateCurrentSession })).rejects.toBe(failure);
  });
});

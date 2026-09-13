import { describe, expect, it } from "vitest";
import { resolveAuthCallbackNotice } from "@/modules/identity/application/auth-callback";

describe("auth callback notices", () => {
  it("recognizes provider error descriptions even without a structured error code", () => {
    expect(resolveAuthCallbackNotice(null, null, "provider details")).toBe("verification_failed");
  });

  it("does not classify an empty callback as an error", () => {
    expect(resolveAuthCallbackNotice(null, null)).toBeNull();
  });
});

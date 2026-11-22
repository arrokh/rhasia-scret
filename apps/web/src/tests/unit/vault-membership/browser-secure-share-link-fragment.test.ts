/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/infrastructure/browser-location-fragment", () => ({
  consumeBrowserLocationFragment: vi.fn(),
}));

import { consumeBrowserLocationFragment } from "@/shared/infrastructure/browser-location-fragment";
import { consumeSecureShareLinkSecretFromLocation } from "@/modules/vault-membership/infrastructure/browser-secure-share-link-fragment";

describe("consumeSecureShareLinkSecretFromLocation", () => {
  beforeEach(() => {
    vi.mocked(consumeBrowserLocationFragment).mockReset();
    window.history.replaceState(null, "", "/vaults/invitations/redeem");
  });

  it("accepts only the 32-byte base64url secret format", () => {
    const secret = "synthetic-secure-share-link-secret-00000000";
    window.history.replaceState(null, "", `/vaults/invitations/redeem#${secret}`);
    vi.mocked(consumeBrowserLocationFragment).mockReturnValue(secret);

    expect(consumeSecureShareLinkSecretFromLocation()).toBe(secret);
    expect(consumeBrowserLocationFragment).toHaveBeenCalledOnce();
  });

  it("rejects invalid lengths and alphabet without consuming later anchor changes", () => {
    for (const fragment of ["A".repeat(42), "A".repeat(44), `${"A".repeat(42)}!`]) {
      window.history.replaceState(null, "", `/vaults/invitations/redeem#${fragment}`);

      expect(consumeSecureShareLinkSecretFromLocation({ clearInvalidFragment: false })).toBe("");
      expect(consumeBrowserLocationFragment).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(`#${fragment}`);
    }
  });

  it("rejects a consumed fragment that does not match the secret format", () => {
    window.history.replaceState(null, "", `/vaults/invitations/redeem#${"A".repeat(43)}`);
    vi.mocked(consumeBrowserLocationFragment).mockReturnValue("A".repeat(42));

    expect(consumeSecureShareLinkSecretFromLocation()).toBe("");
    expect(consumeBrowserLocationFragment).toHaveBeenCalledOnce();
  });

  it("preserves a long URL-safe anchor during later fragment changes", () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#account-settings-security-notice");

    expect(consumeSecureShareLinkSecretFromLocation({ clearInvalidFragment: false })).toBe("");
    expect(consumeBrowserLocationFragment).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#account-settings-security-notice");
  });

  it("returns no secret when fragment cleanup fails", () => {
    vi.mocked(consumeBrowserLocationFragment).mockReturnValue(null);

    expect(consumeSecureShareLinkSecretFromLocation()).toBe("");
  });
});

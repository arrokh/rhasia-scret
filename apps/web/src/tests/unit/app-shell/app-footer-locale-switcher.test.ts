import { describe, expect, it } from "vitest";
import { footerLanguageIsInSettings } from "@/shared/presentation/app-footer-locale-switcher";

describe("footer language placement", () => {
  it("keeps the footer switcher visible when pathname is not available during SSR", () => {
    expect(footerLanguageIsInSettings(null)).toBe(false);
  });

  it("uses header Settings only on routes that actually render the account menu", () => {
    for (const pathname of [
      "/vaults",
      "/vaults/accounts/new",
      "/vaults/invitations/redeem",
      "/ui-preview",
      "/ui-preview/vaults",
    ]) {
      expect(footerLanguageIsInSettings(pathname)).toBe(true);
    }

    for (const pathname of ["/", "/sign-in", "/local", "/offline", "/smoke", "/totp", "/ui-preview/archive-backup"]) {
      expect(footerLanguageIsInSettings(pathname)).toBe(false);
    }
  });
});

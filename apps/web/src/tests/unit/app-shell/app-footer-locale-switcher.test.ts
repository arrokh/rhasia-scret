import { describe, expect, it } from "vitest";
import { footerLanguageIsHidden, footerLanguageIsMobileOnly } from "@/shared/presentation/app-footer-locale-switcher";

describe("footer language placement", () => {
  it("keeps the footer switcher visible when pathname is not available during SSR", () => {
    expect(footerLanguageIsHidden(null)).toBe(false);
  });

  it("hides the footer switcher on account-menu routes", () => {
    for (const pathname of [
      "/vaults",
      "/vaults/accounts/new",
      "/vaults/invitations/redeem",
      "/ui-preview",
      "/ui-preview/vaults",
    ]) {
      expect(footerLanguageIsHidden(pathname)).toBe(true);
    }

    for (const pathname of ["/sign-in", "/local", "/smoke", "/totp", "/ui-preview/archive-backup"]) {
      expect(footerLanguageIsHidden(pathname)).toBe(false);
    }

    expect(footerLanguageIsHidden("/")).toBe(false);
    expect(footerLanguageIsHidden("/offline")).toBe(false);
  });

  it("limits the landing footer switcher to mobile", () => {
    expect(footerLanguageIsMobileOnly("/")).toBe(true);
    expect(footerLanguageIsMobileOnly("/offline")).toBe(false);
    expect(footerLanguageIsMobileOnly(null)).toBe(false);
  });
});

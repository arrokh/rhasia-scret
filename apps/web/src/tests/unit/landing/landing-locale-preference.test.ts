/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLocalePreference } from "@/i18n/locale-switcher";

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
afterEach(() => {
  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
  document.cookie = "RHSIA_LOCALE=; Path=/; Max-Age=0";
  vi.restoreAllMocks();
});

describe("landing locale preference", () => {
  it("refreshes the offline shell even when the first choice reaffirms the default locale", async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
    expect(await applyLocalePreference("id", "id")).toBe(true);
    expect(getRegistration).toHaveBeenCalledOnce();
    expect(document.cookie).toContain("RHSIA_LOCALE=id");
  });

  it("does not turn a failed first choice into a remembered preference", async () => {
    const getRegistration = vi.fn().mockRejectedValue(new Error("Synthetic offline shell failure"));
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
    expect(await applyLocalePreference("en", "id", { firstChoice: true })).toBe(false);
    expect(document.cookie).not.toContain("RHSIA_LOCALE=");
    expect(document.documentElement.lang).toBe("id");
  });
});

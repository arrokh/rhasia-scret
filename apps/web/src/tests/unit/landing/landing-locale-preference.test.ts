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
  it("refreshes the offline shell when a preference reaffirms the default locale", async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
    expect(await applyLocalePreference("id", "id")).toBe(true);
    expect(getRegistration).toHaveBeenCalledOnce();
    expect(document.cookie).toContain("RHSIA_LOCALE=id");
  });

  it("restores the current locale when applying a new preference fails", async () => {
    const getRegistration = vi.fn().mockRejectedValue(new Error("Synthetic offline shell failure"));
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
    expect(await applyLocalePreference("en", "id")).toBe(false);
    expect(document.cookie).toContain("RHSIA_LOCALE=id");
    expect(document.documentElement.lang).toBe("id");
  });
});

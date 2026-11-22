/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  consumeBrowserFragment,
  consumeBrowserLocationFragment,
  tryReplaceBrowserUrlWithoutFragment,
} from "@/shared/infrastructure/browser-location-fragment";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("browser URL fragment handling", () => {
  it("removes the current fragment before returning it", () => {
    window.history.replaceState(null, "", "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem#synthetic-fragment");

    expect(consumeBrowserLocationFragment()).toBe("synthetic-fragment");
    expect(window.location.pathname).toBe("/sign-in");
    expect(window.location.search).toBe("?next=%2Fvaults%2Finvitations%2Fredeem");
    expect(window.location.hash).toBe("");
  });

  it("does not return a fragment when history cleanup fails and requests a clean navigation", () => {
    let fallbackUrl: string | undefined;
    const fragment = consumeBrowserFragment("#synthetic-fragment", () =>
      tryReplaceBrowserUrlWithoutFragment(
        "/sign-in?next=%2Fvaults%2Finvitations%2Fredeem",
        () => {
          throw new Error("Synthetic history cleanup failure.");
        },
        (url) => {
          fallbackUrl = url;
        },
      ),
    );

    expect(fragment).toBeNull();
    expect(fallbackUrl).toBe("/sign-in?next=%2Fvaults%2Finvitations%2Fredeem");
  });

  it("fails closed if both history cleanup and clean navigation fail", () => {
    const fragment = consumeBrowserFragment("#synthetic-fragment", () =>
      tryReplaceBrowserUrlWithoutFragment(
        "/sign-in",
        () => {
          throw new Error("Synthetic history cleanup failure.");
        },
        () => {
          throw new Error("Synthetic clean navigation failure.");
        },
      ),
    );

    expect(fragment).toBeNull();
  });
});

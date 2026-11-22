/** @vitest-environment jsdom */

import { act, createElement, StrictMode, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecureShareLinkSecretProvider, useSecureShareLinkSecret } from "@/modules/vault-membership";
import {
  clearSecureShareLinkSecret,
  readSecureShareLinkSecret,
} from "@/modules/vault-membership/infrastructure/browser-secure-share-link-secret-state";
import { QueryProvider } from "@/shared/presentation/query-provider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
const container = document.createElement("div");
const clearSecretClosures: Array<(expectedSecret?: string) => boolean> = [];

function SecretProbe() {
  const { secret, clearSecret } = useSecureShareLinkSecret();
  useEffect(() => {
    clearSecretClosures.push(clearSecret);
  }, [clearSecret]);
  return createElement(
    "section",
    null,
    createElement("output", { "data-secret-state": true }, secret || "missing"),
    createElement("button", { type: "button", onClick: () => clearSecret() }, "clear"),
    createElement(
      "button",
      { type: "button", onClick: () => clearSecret("synthetic-secure-share-link-secret-00000000") },
      "clear expected",
    ),
  );
}

function withProvider(children: ReactNode) {
  return createElement(StrictMode, null, createElement(SecureShareLinkSecretProvider, null, children));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  root = undefined;
  clearSecureShareLinkSecret(`${window.location.pathname}${window.location.search}`);
  clearSecretClosures.length = 0;
  container.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("Secure Share Link secret handoff", () => {
  it("consumes a valid URL fragment into route memory and removes it from browser history", async () => {
    window.history.replaceState(
      null,
      "",
      "/vaults/invitations/redeem?source=synthetic#synthetic-secure-share-link-secret-00000000",
    );

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });

    expect(window.location.pathname).toBe("/vaults/invitations/redeem");
    expect(window.location.search).toBe("?source=synthetic");
    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("scrubs a malformed initial secret fragment", async () => {
    window.history.replaceState(null, "", `/vaults/invitations/redeem#${"A".repeat(42)}`);

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });

    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("missing");
  });

  it("scrubs an exact-length fragment containing a character outside the secret alphabet", async () => {
    const invalidSecret = `${"A".repeat(42)}!`;
    expect(invalidSecret).toHaveLength(43);
    window.history.replaceState(null, "", `/vaults/invitations/redeem#${invalidSecret}`);

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });

    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("missing");
  });

  it("keeps the secret in memory across child refresh and clears it after redemption", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });

    await act(async () => {
      root?.render(withProvider(createElement("div", null, createElement(SecretProbe))));
    });
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(container.querySelector("output")?.textContent).toBe("missing");
  });

  it("preserves the invitation secret across a session-cache remount", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(
          QueryProvider,
          null,
          createElement(SecureShareLinkSecretProvider, null, createElement(SecretProbe)),
        ),
      );
    });
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");

    await act(async () => window.dispatchEvent(new Event("rhasia-scret:session-change")));

    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");
    await act(async () => container.querySelector("button")?.click());
    expect(container.querySelector("output")?.textContent).toBe("missing");
  });

  it("preserves the in-memory secret across unrelated hash changes", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });

    window.history.replaceState(null, "", "/vaults/invitations/redeem#account-settings-security-notice");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(window.location.hash).toBe("#account-settings-security-notice");
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");

    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000001");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));

    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000001");
  });

  it("clears the secret when the invitation route scope changes", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");

    window.history.replaceState(null, "", "/vaults/invitations/redeem?next=synthetic");
    await act(async () => root?.render(withProvider(createElement(SecretProbe))));

    expect(container.querySelector("output")?.textContent).toBe("missing");
  });

  it("does not let a stale scope clear a newer invitation secret", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SecureShareLinkSecretProvider, null, createElement(SecretProbe)));
    });
    const clearOldScope = clearSecretClosures[0];
    expect(clearOldScope).toBeDefined();

    window.history.replaceState(null, "", "/vaults/invitations/redeem?next=synthetic");
    await act(async () => root?.render(createElement(SecureShareLinkSecretProvider, null, createElement(SecretProbe))));
    window.history.replaceState(
      null,
      "",
      "/vaults/invitations/redeem?next=synthetic#synthetic-secure-share-link-secret-00000001",
    );
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));

    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000001");
    await act(async () => {
      expect(clearOldScope?.("synthetic-secure-share-link-secret-00000000")).toBe(false);
    });
    expect(readSecureShareLinkSecret("/vaults/invitations/redeem?next=synthetic")).toBe(
      "synthetic-secure-share-link-secret-00000001",
    );
  });

  it("clears the in-memory secret after the last provider unmounts", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SecureShareLinkSecretProvider, null, createElement(SecretProbe)));
    });
    expect(readSecureShareLinkSecret("/vaults/invitations/redeem")).toBe("synthetic-secure-share-link-secret-00000000");

    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(readSecureShareLinkSecret("/vaults/invitations/redeem")).toBe("");
  });

  it("expires an invitation secret after the maximum authentication link lifetime", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000000");

    await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));

    expect(container.querySelector("output")?.textContent).toBe("missing");
  });

  it("does not clear a newer secret when redemption of the previous secret completes", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });

    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000001");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await act(async () => container.querySelector<HTMLButtonElement>("button:nth-of-type(2)")?.click());

    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000001");
  });

  it("scrubs a non-secret initial fragment and consumes a later invitation hash change", async () => {
    window.history.replaceState(null, "", "/vaults/invitations/redeem#account-settings-security-notice");

    await act(async () => {
      root = createRoot(container);
      root.render(withProvider(createElement(SecretProbe)));
    });
    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("missing");

    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000001");
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("synthetic-secure-share-link-secret-00000001");
  });
});

/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("@/modules/identity/infrastructure/browser-session-client", () => ({
  refreshBrowserSessionAssertion: mocks.refresh,
}));

import { BrowserSessionRefresh } from "@/modules/identity/presentation/browser-session-refresh";

describe("BrowserSessionRefresh", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not start a keepalive race while a magic link is being redeemed", async () => {
    window.history.replaceState(null, "", "/auth/confirm#token=one-time-token");
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(BrowserSessionRefresh));
      await Promise.resolve();
    });

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not rotate a browser session twice during Strict Mode effect replay", async () => {
    mocks.refresh.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(BrowserSessionRefresh)));
      await Promise.resolve();
    });

    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("renews an active browser session when a tab regains focus and once a day", async () => {
    vi.useFakeTimers();
    mocks.refresh.mockResolvedValue(undefined);
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(BrowserSessionRefresh));
      await Promise.resolve();
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });
});

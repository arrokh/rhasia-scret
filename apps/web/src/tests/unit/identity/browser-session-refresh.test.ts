/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  postJson: vi.fn(),
}));

vi.mock("@/shared/infrastructure/browser-api-client", () => ({
  browserApiClient: { postJson: mocks.postJson },
}));

import { BrowserSessionRefresh } from "@/modules/identity/presentation/browser-session-refresh";

describe("BrowserSessionRefresh", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
  });

  it("does not start a keepalive race while a magic link is being redeemed", async () => {
    window.history.replaceState(null, "", "/auth/confirm#token=one-time-token");
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(BrowserSessionRefresh));
      await Promise.resolve();
    });

    expect(mocks.postJson).not.toHaveBeenCalled();
  });

  it("does not rotate a browser session twice during Strict Mode effect replay", async () => {
    mocks.postJson.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(BrowserSessionRefresh)));
      await Promise.resolve();
    });

    expect(mocks.postJson).toHaveBeenCalledOnce();
    expect(mocks.postJson).toHaveBeenCalledWith("/api/auth/session/refresh", { client: "web" });
  });
});

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

const mocks = vi.hoisted(() => ({
  clearAllOfflineVaultData: vi.fn(),
  requestLocalVaultLock: vi.fn(),
  requestVaultSessionChange: vi.fn(),
}));
vi.mock("@/modules/sync", () => ({
  clearAllOfflineVaultData: mocks.clearAllOfflineVaultData,
  requestLocalVaultLock: mocks.requestLocalVaultLock,
  requestVaultSessionChange: mocks.requestVaultSessionChange,
}));

import {
  refreshBrowserSessionAssertion,
  terminateBrowserSession,
} from "@/modules/identity/infrastructure/browser-session-client";

describe("terminateBrowserSession", () => {
  beforeEach(() => {
    mocks.requestVaultSessionChange.mockImplementation(() => mocks.requestLocalVaultLock());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("renews the assertion through the identity API client", async () => {
    const postJson = vi.spyOn(browserApiClient, "postJson").mockResolvedValue({ refreshed: true });

    await refreshBrowserSessionAssertion();

    expect(postJson).toHaveBeenCalledOnce();
    expect(postJson).toHaveBeenCalledWith("/api/v1/auth/session/refresh", { client: "web" });
  });

  it("keeps anonymous or expired-session refresh failures quiet", async () => {
    vi.spyOn(browserApiClient, "postJson").mockRejectedValue(new Error("synthetic session unavailable"));

    await expect(refreshBrowserSessionAssertion()).resolves.toBeUndefined();
  });

  it("starts local cleanup before the parallel successful server logout attempt", async () => {
    const order: string[] = [];
    mocks.requestLocalVaultLock.mockImplementation(() => {
      order.push("local-lock");
    });
    mocks.requestVaultSessionChange.mockImplementation(() => {
      mocks.requestLocalVaultLock();
      order.push("cross-tab-lock");
    });
    mocks.clearAllOfflineVaultData.mockImplementation(async () => {
      order.push("local-cleanup");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        order.push("server-logout");
        return { ok: true, url: `${window.location.origin}/sign-in?auth=signed_out` };
      }),
    );

    await expect(terminateBrowserSession()).resolves.toBe("/sign-in?auth=signed_out");
    expect(order).toEqual([
      "local-lock",
      "cross-tab-lock",
      "local-cleanup",
      "server-logout",
      "local-lock",
      "cross-tab-lock",
    ]);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledTimes(2);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("retries the session-change announcement after an initial failure", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    mocks.requestVaultSessionChange.mockImplementationOnce(() => {
      throw new Error("synthetic initial announcement failure");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        url: `${window.location.origin}/sign-in?auth=signed_out`,
      }),
    );

    await expect(terminateBrowserSession()).resolves.toBe("/sign-in?auth=signed_out");
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("reports the retry session-change error when both announcements fail", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    mocks.requestVaultSessionChange
      .mockImplementationOnce(() => {
        throw new Error("synthetic initial announcement failure");
      })
      .mockImplementationOnce(() => {
        throw new Error("synthetic retry announcement failure");
      });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        url: `${window.location.origin}/sign-in?auth=signed_out`,
      }),
    );

    await expect(terminateBrowserSession()).rejects.toThrow("synthetic retry announcement failure");
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("treats a followed logout-failure redirect as a failed revocation", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        url: `${window.location.origin}/sign-in?auth=logout_failed`,
      }),
    );

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledTimes(2);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("classifies an authenticated-user logout failure redirect as an error", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        url: `${window.location.origin}/vaults?logout=failed`,
      }),
    );

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("rejects a sign-in destination without an explicit signed-out outcome", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: `${window.location.origin}/sign-in` }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("rejects a foreign-origin logout destination", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: "https://other.test/sign-in?auth=signed_out" }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("rejects unexpected same-origin logout destinations", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: `${window.location.origin}//other.test/path` }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a successful logout response omits its URL", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: "" }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledTimes(2);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("attempts server revocation even when local cleanup fails", async () => {
    mocks.clearAllOfflineVaultData.mockRejectedValue(new Error("IndexedDB unavailable"));
    const order: string[] = [];
    mocks.requestLocalVaultLock.mockImplementation(() => order.push("local-lock"));
    mocks.requestVaultSessionChange.mockImplementation(() => {
      mocks.requestLocalVaultLock();
      order.push("cross-tab-lock");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        order.push("server-logout");
        return { ok: true, url: `${window.location.origin}/sign-in?auth=signed_out` };
      }),
    );

    await expect(terminateBrowserSession()).rejects.toThrow(/IndexedDB unavailable/);
    expect(order).toEqual(["local-lock", "cross-tab-lock", "server-logout", "local-lock", "cross-tab-lock"]);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("announces session change and attempts revocation before bounded cleanup completes", async () => {
    vi.useFakeTimers();
    mocks.clearAllOfflineVaultData.mockReturnValue(new Promise(() => undefined));
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: `${window.location.origin}/sign-in?auth=signed_out`,
    });
    vi.stubGlobal("fetch", fetch);

    const result = terminateBrowserSession();
    const resultAssertion = expect(result).rejects.toThrow(/cleanup did not complete before the timeout/);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);
    await resultAssertion;
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledTimes(2);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("bounds the server request and treats a timeout as a failed logout", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("Request timed out", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(terminateBrowserSession()).rejects.toThrow(/timed out/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });

  it("keeps local cleanup complete when server logout fails", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, url: "" }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.clearAllOfflineVaultData).toHaveBeenCalledOnce();
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledTimes(2);
    expect(mocks.requestVaultSessionChange).toHaveBeenCalledTimes(2);
  });
});

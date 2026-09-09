/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clearAllOfflineVaultData: vi.fn(), requestLocalVaultLock: vi.fn() }));
vi.mock("@/modules/sync", () => ({
  clearAllOfflineVaultData: mocks.clearAllOfflineVaultData,
  requestLocalVaultLock: mocks.requestLocalVaultLock,
}));

import { terminateBrowserSession } from "@/modules/identity/infrastructure/browser-session-client";

describe("terminateBrowserSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("clears all local snapshot and Remembered Browser data before successful server logout", async () => {
    const order: string[] = [];
    mocks.requestLocalVaultLock.mockImplementation(() => {
      order.push("in-memory-lock");
    });
    mocks.clearAllOfflineVaultData.mockImplementation(async () => {
      order.push("local-cleanup");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        order.push("server-logout");
        return { ok: true, url: "/sign-in?auth=signed_out" };
      }),
    );

    await expect(terminateBrowserSession()).resolves.toBe("/sign-in?auth=signed_out");
    expect(order).toEqual(["in-memory-lock", "local-cleanup", "server-logout"]);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
  });

  it("falls back to sign in when a successful logout response omits its URL", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: "" }));

    await expect(terminateBrowserSession()).resolves.toBe("/sign-in");
  });

  it("locks in-memory keys even when local cleanup fails", async () => {
    mocks.clearAllOfflineVaultData.mockRejectedValue(new Error("IndexedDB unavailable"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(terminateBrowserSession()).rejects.toThrow(/IndexedDB unavailable/);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps local cleanup complete when server logout fails", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, url: "" }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.clearAllOfflineVaultData).toHaveBeenCalledOnce();
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
  });
});

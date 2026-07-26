/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clearAllOfflineVaultData: vi.fn(), requestLocalVaultLock: vi.fn() }));
vi.mock("@/modules/sync", () => ({ clearAllOfflineVaultData: mocks.clearAllOfflineVaultData, requestLocalVaultLock: mocks.requestLocalVaultLock }));

import { terminateBrowserSession } from "@/modules/identity/infrastructure/browser-session-client";

describe("terminateBrowserSession", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("clears all local snapshot and Remembered Browser data before successful server logout", async () => {
    const order: string[] = [];
    mocks.clearAllOfflineVaultData.mockImplementation(async () => { order.push("local-cleanup"); });
    vi.stubGlobal("fetch", vi.fn(async () => { order.push("server-logout"); return { ok: true, url: "/?auth=signed_out" }; }));

    await expect(terminateBrowserSession()).resolves.toBe("/?auth=signed_out");
    expect(order).toEqual(["local-cleanup", "server-logout"]);
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
  });

  it("keeps local cleanup complete when server logout fails", async () => {
    mocks.clearAllOfflineVaultData.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, url: "" }));

    await expect(terminateBrowserSession()).rejects.toThrow(/termination failed/);
    expect(mocks.clearAllOfflineVaultData).toHaveBeenCalledOnce();
    expect(mocks.requestLocalVaultLock).toHaveBeenCalledOnce();
  });
});

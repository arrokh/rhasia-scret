import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAccountDirectoryPreferences: vi.fn(),
  terminateBrowserSession: vi.fn(),
}));

vi.mock("@/modules/authenticator-account", () => ({
  clearAccountDirectoryPreferences: mocks.clearAccountDirectoryPreferences,
}));
vi.mock("@/modules/identity", () => ({ terminateBrowserSession: mocks.terminateBrowserSession }));

import { clearDeletedBrowserState } from "@/modules/account-deletion/infrastructure/browser-account-deletion-client";

describe("clearDeletedBrowserState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it("terminates the session before clearing directory preferences", async () => {
    const order: string[] = [];
    mocks.clearAccountDirectoryPreferences.mockImplementation(() => order.push("directory-clear"));
    mocks.terminateBrowserSession.mockImplementation(async () => order.push("terminate-session"));

    await clearDeletedBrowserState();

    expect(order).toEqual(["terminate-session", "directory-clear"]);
  });

  it("still clears directory preferences when session termination fails", async () => {
    mocks.terminateBrowserSession.mockRejectedValue(new Error("synthetic session termination failure"));

    await expect(clearDeletedBrowserState()).rejects.toThrow("synthetic session termination failure");

    expect(mocks.clearAccountDirectoryPreferences).toHaveBeenCalledOnce();
  });

  it("still terminates the session when directory preference cleanup fails", async () => {
    const order: string[] = [];
    mocks.terminateBrowserSession.mockImplementation(async () => order.push("terminate-session"));
    mocks.clearAccountDirectoryPreferences.mockImplementation(() => {
      order.push("directory-clear");
      throw new Error("synthetic directory cleanup failure");
    });

    await expect(clearDeletedBrowserState()).rejects.toThrow("synthetic directory cleanup failure");

    expect(order).toEqual(["terminate-session", "directory-clear"]);
    expect(mocks.terminateBrowserSession).toHaveBeenCalledOnce();
  });
});

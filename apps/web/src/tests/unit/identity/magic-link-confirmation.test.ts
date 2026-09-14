/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  announceAuthenticationCompletion: vi.fn(),
  redeemBrowserMagicLink: vi.fn(),
  requestInvitationSecret: vi.fn(),
}));

vi.mock("@/modules/identity/infrastructure/browser-passwordless-client", () => ({
  redeemBrowserMagicLink: mocks.redeemBrowserMagicLink,
}));
vi.mock("@/modules/identity/presentation/auth-completion-channel", () => ({
  announceAuthenticationCompletion: mocks.announceAuthenticationCompletion,
  requestInvitationSecret: mocks.requestInvitationSecret,
}));

import { MagicLinkConfirmation } from "@/modules/identity/presentation/magic-link-confirmation";

describe("MagicLinkConfirmation", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
  });

  it("does not treat Strict Mode's effect replay as a missing token", async () => {
    window.history.replaceState(null, "", "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK");
    mocks.redeemBrowserMagicLink.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(MagicLinkConfirmation)));
      await Promise.resolve();
    });

    expect(mocks.redeemBrowserMagicLink).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("announces completion and navigates directly to the invitation return path", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults%2Finvitations%2Fredeem",
    );
    mocks.redeemBrowserMagicLink.mockResolvedValueOnce({ returnPath: "/vaults/invitations/redeem" });
    mocks.requestInvitationSecret.mockResolvedValueOnce("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK");
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { navigate } as { navigate: (path: string) => void }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestInvitationSecret).toHaveBeenCalledOnce();
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/vaults/invitations/redeem#abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("offers navigation back to sign in or home when redemption fails", async () => {
    window.history.replaceState(null, "", "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK");
    mocks.redeemBrowserMagicLink.mockRejectedValueOnce(new Error("expired"));
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Tautan masuk ini tidak valid atau sudah kedaluwarsa.",
    );
    expect(container.querySelector<HTMLAnchorElement>('a[href="/sign-in"]')?.textContent).toBe(
      "Kembali ke halaman masuk",
    );
    expect(container.querySelector<HTMLAnchorElement>('a[href="/"]')?.textContent).toBe("Kembali ke beranda");
  });
});

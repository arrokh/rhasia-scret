/** @vitest-environment jsdom */

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  announceAuthenticationCompletion: vi.fn(),
  announcePwaAuthenticationCompletion: vi.fn(),
  clearPwaAuthenticationHandoff: vi.fn(),
  isPwaDisplayMode: vi.fn(() => false),
  pollPwaAuthenticationHandoff: vi.fn(),
  readPwaAuthenticationHandoff: vi.fn((): { handoffId: string; verifier: string } | null => null),
  requestPwaAuthenticationVerifier: vi.fn(),
  publishPwaAuthenticationHandoff: vi.fn().mockResolvedValue(undefined),
  redeemBrowserMagicLink: vi.fn(),
  redeemPwaMagicLink: vi.fn(),
  requestInvitationSecret: vi.fn(),
}));

vi.mock("@/modules/identity/infrastructure/browser-passwordless-client", () => ({
  pollPwaAuthenticationHandoff: mocks.pollPwaAuthenticationHandoff,
  publishPwaAuthenticationHandoff: mocks.publishPwaAuthenticationHandoff,
  redeemBrowserMagicLink: mocks.redeemBrowserMagicLink,
  redeemPwaMagicLink: mocks.redeemPwaMagicLink,
}));
vi.mock("@/modules/identity/presentation/auth-completion-channel", () => ({
  announceAuthenticationCompletion: mocks.announceAuthenticationCompletion,
  requestInvitationSecret: mocks.requestInvitationSecret,
}));
vi.mock("@/modules/identity/infrastructure/pwa-authentication", () => ({
  announcePwaAuthenticationCompletion: mocks.announcePwaAuthenticationCompletion,
  clearPwaAuthenticationHandoff: mocks.clearPwaAuthenticationHandoff,
  isPwaDisplayMode: mocks.isPwaDisplayMode,
  readPwaAuthenticationHandoff: mocks.readPwaAuthenticationHandoff,
  requestPwaAuthenticationVerifier: mocks.requestPwaAuthenticationVerifier,
}));

import { MagicLinkConfirmation } from "@/modules/identity/presentation/magic-link-confirmation";

describe("MagicLinkConfirmation", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
    mocks.isPwaDisplayMode.mockReturnValue(false);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
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

  it("hands a PWA session back without signing in the browser context", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults&handoff=pwa-handoff-123456",
    );
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults",
    });
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.redeemPwaMagicLink).toHaveBeenCalledWith("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK");
    expect(mocks.publishPwaAuthenticationHandoff).toHaveBeenCalledWith(
      "pwa-handoff-123456",
      "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
    );
    expect(container.textContent).toContain("rhasia-scret sedang membuka sesi");
    expect(mocks.announceAuthenticationCompletion).not.toHaveBeenCalled();
  });

  it("recovers the verifier when the callback opens in a new PWA window", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults%2Finvitations%2Fredeem&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.requestPwaAuthenticationVerifier.mockResolvedValueOnce("v".repeat(43));
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults/invitations/redeem",
    });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({
      accepted: true,
      returnPath: "/vaults/invitations/redeem",
    });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa", navigate }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestPwaAuthenticationVerifier).toHaveBeenCalledWith("pwa-handoff-123456");
    expect(mocks.redeemPwaMagicLink).toHaveBeenCalledOnce();
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("announces completion when the callback opens inside the installed PWA", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults%2Finvitations%2Fredeem&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults/invitations/redeem",
    });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({
      accepted: true,
      returnPath: "/vaults/invitations/redeem",
    });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa", navigate }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.announcePwaAuthenticationCompletion).toHaveBeenCalledWith("pwa-handoff-123456");
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/vaults/invitations/redeem");
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

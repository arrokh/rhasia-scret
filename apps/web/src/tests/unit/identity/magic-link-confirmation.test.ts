/** @vitest-environment jsdom */

import { act, createElement, Fragment, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => {
  const readPwaAuthenticationHandoff = vi.fn((): { handoffId: string; verifier: string } | null => null);
  let pwaCompletionListener: ((handoffId: string, returnPath: string) => void) | undefined;
  return {
    announceAuthenticationCompletion: vi.fn(() => {
      window.dispatchEvent(new Event("rhasia-scret:session-change"));
    }),
    announcePwaAuthenticationCompletion: vi.fn(),
    clearPwaAuthenticationHandoff: vi.fn(),
    isPwaDisplayMode: vi.fn(() => false),
    pollPwaAuthenticationHandoff: vi.fn(),
    readPwaAuthenticationHandoff,
    readPwaAuthenticationHandoffById: vi.fn((handoffId: string) => {
      const pending = readPwaAuthenticationHandoff();
      return pending?.handoffId === handoffId ? pending : null;
    }),
    requestPwaAuthenticationVerifier: vi.fn(),
    subscribeToPwaAuthenticationCompletion: vi.fn((listener: (handoffId: string, returnPath: string) => void) => {
      pwaCompletionListener = listener;
      return () => {
        if (pwaCompletionListener === listener) pwaCompletionListener = undefined;
      };
    }),
    completePwaAuthentication(handoffId: string, returnPath: string) {
      pwaCompletionListener?.(handoffId, returnPath);
    },
    publishPwaAuthenticationHandoff: vi.fn().mockResolvedValue(undefined),
    redeemBrowserMagicLink: vi.fn(),
    redeemPwaMagicLink: vi.fn(),
  };
});

vi.mock("@/modules/identity/infrastructure/browser-passwordless-client", () => ({
  pollPwaAuthenticationHandoff: mocks.pollPwaAuthenticationHandoff,
  publishPwaAuthenticationHandoff: mocks.publishPwaAuthenticationHandoff,
  redeemBrowserMagicLink: mocks.redeemBrowserMagicLink,
  redeemPwaMagicLink: mocks.redeemPwaMagicLink,
}));
vi.mock("@/modules/identity/presentation/auth-completion-channel", () => ({
  announceAuthenticationCompletion: mocks.announceAuthenticationCompletion,
}));
vi.mock("@/modules/identity/infrastructure/pwa-authentication", () => ({
  announcePwaAuthenticationCompletion: mocks.announcePwaAuthenticationCompletion,
  clearPwaAuthenticationHandoff: mocks.clearPwaAuthenticationHandoff,
  isPwaDisplayMode: mocks.isPwaDisplayMode,
  readPwaAuthenticationHandoff: mocks.readPwaAuthenticationHandoff,
  readPwaAuthenticationHandoffById: mocks.readPwaAuthenticationHandoffById,
  requestPwaAuthenticationVerifier: mocks.requestPwaAuthenticationVerifier,
  subscribeToPwaAuthenticationCompletion: mocks.subscribeToPwaAuthenticationCompletion,
}));
vi.mock("@/shared/infrastructure/browser-location-fragment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/infrastructure/browser-location-fragment")>();
  return { ...actual, consumeBrowserLocationFragment: vi.fn(actual.consumeBrowserLocationFragment) };
});

import { MagicLinkConfirmation } from "@/modules/identity/presentation/magic-link-confirmation";
import { QueryProvider } from "@/shared/presentation/query-provider";
import { consumeBrowserLocationFragment } from "@/shared/infrastructure/browser-location-fragment";

const observedQueryClients: QueryClient[] = [];

function ObserveQueryClient() {
  const queryClient = useQueryClient();
  useEffect(() => {
    observedQueryClients.push(queryClient);
  }, [queryClient]);
  return null;
}

describe("MagicLinkConfirmation", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    window.history.replaceState(null, "", "/");
    observedQueryClients.length = 0;
    vi.clearAllMocks();
    mocks.isPwaDisplayMode.mockReturnValue(false);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.subscribeToPwaAuthenticationCompletion.mockClear();
  });

  it("shows a bounded failure when the callback cannot safely consume its fragment", async () => {
    window.history.replaceState(null, "", "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK");
    vi.mocked(consumeBrowserLocationFragment).mockReturnValueOnce(null);
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(mocks.redeemBrowserMagicLink).not.toHaveBeenCalled();
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

  it("announces completion and leaves invitation redemption to the source tab", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults%2Finvitations%2Fredeem",
    );
    mocks.redeemBrowserMagicLink.mockResolvedValueOnce({ returnPath: "/vaults/invitations/redeem" });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { navigate } as { navigate: (path: string) => void }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/auth/complete");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("continues a web callback through a session change without remounting its child", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults",
    );
    let completeRedemption: ((value: { returnPath: string }) => void) | undefined;
    mocks.redeemBrowserMagicLink.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeRedemption = resolve;
        }),
    );
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          QueryProvider,
          null,
          createElement(
            Fragment,
            null,
            createElement(MagicLinkConfirmation, { navigate } as { navigate: (path: string) => void }),
            createElement(ObserveQueryClient),
          ),
        ),
      );
      await Promise.resolve();
    });
    expect(mocks.redeemBrowserMagicLink).toHaveBeenCalledOnce();
    expect(completeRedemption).toBeDefined();
    const oldQueryClient = observedQueryClients[0];
    expect(oldQueryClient).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new Event("rhasia-scret:session-change"));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(observedQueryClients).toHaveLength(2);
    expect(observedQueryClients[1]).not.toBe(oldQueryClient);

    await act(async () => {
      completeRedemption?.({ returnPath: "/vaults" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith("/vaults");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("continues a PWA callback through a session change without remounting its child", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults&handoff=pwa-handoff-123456",
    );
    let completeRedemption: ((value: { refreshToken: string; returnPath: string }) => void) | undefined;
    mocks.redeemPwaMagicLink.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeRedemption = resolve;
        }),
    );
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          QueryProvider,
          null,
          createElement(
            Fragment,
            null,
            createElement(MagicLinkConfirmation, { client: "pwa" }),
            createElement(ObserveQueryClient),
          ),
        ),
      );
      await Promise.resolve();
    });
    expect(mocks.redeemPwaMagicLink).toHaveBeenCalledOnce();
    const oldQueryClient = observedQueryClients[0];
    expect(oldQueryClient).toBeDefined();

    await act(async () => window.dispatchEvent(new Event("rhasia-scret:session-change")));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(observedQueryClients).toHaveLength(2);
    expect(observedQueryClients[1]).not.toBe(oldQueryClient);

    await act(async () => {
      completeRedemption?.({
        refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
        returnPath: "/vaults",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Tautan masuk terverifikasi.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a successful callback neutral while replacing the query client", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults",
    );
    mocks.redeemBrowserMagicLink.mockResolvedValueOnce({ returnPath: "/vaults" });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          QueryProvider,
          null,
          createElement(MagicLinkConfirmation, { navigate } as { navigate: (path: string) => void }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/vaults");
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
    expect(container.textContent).toContain("Tautan masuk terverifikasi.");
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
    expect(navigate).toHaveBeenCalledWith("/auth/complete");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("reads a provisional verifier from session-scoped state before requesting another window", async () => {
    const provisionalHandoff = { handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) };
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.readPwaAuthenticationHandoffById.mockReturnValueOnce(provisionalHandoff);
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults",
    });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({ accepted: true, returnPath: "/vaults" });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa", navigate }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestPwaAuthenticationVerifier).not.toHaveBeenCalled();
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledWith(provisionalHandoff);
    expect(navigate).toHaveBeenCalledWith("/vaults");
  });

  it("navigates when another PWA window consumes the callback handoff first", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults",
    });
    mocks.pollPwaAuthenticationHandoff.mockImplementationOnce(async () => {
      mocks.completePwaAuthentication("pwa-handoff-123456", "/vaults");
      return { pending: true };
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

    expect(mocks.subscribeToPwaAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledOnce();
    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalledWith("pwa-handoff-123456");
    expect(navigate).toHaveBeenCalledWith("/vaults");
    expect(container.textContent).not.toContain("Kembali ke aplikasi terpasang");
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

    expect(mocks.announcePwaAuthenticationCompletion).toHaveBeenCalledWith(
      "pwa-handoff-123456",
      "/vaults/invitations/redeem",
    );
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/auth/complete");
  });

  it("shows a neutral return-to-app state when another PWA window consumed the handoff first", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults/invitations/redeem",
    });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({ pending: true });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa", navigate }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.publishPwaAuthenticationHandoff).toHaveBeenCalledOnce();
    expect(mocks.clearPwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(mocks.announcePwaAuthenticationCompletion).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Tautan masuk terverifikasi.");
    expect(container.textContent).toContain("Kembali ke aplikasi terpasang");
    expect(container.textContent).toContain("minta tautan masuk baru dari aplikasi");
    expect(container.textContent).not.toContain("buka kembali tautan masuk asli");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps a published handoff pending when the callback poll fails", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults",
    });
    mocks.pollPwaAuthenticationHandoff.mockRejectedValueOnce(new Error("synthetic network failure"));
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa", navigate }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.publishPwaAuthenticationHandoff).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Tautan masuk terverifikasi.");
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => mocks.completePwaAuthentication("pwa-handoff-123456", "/vaults"));

    expect(navigate).toHaveBeenCalledWith("/vaults");
  });

  it("does not show failure if completion arrives while the callback poll rejects", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults",
    });
    mocks.pollPwaAuthenticationHandoff.mockImplementationOnce(async () => {
      mocks.completePwaAuthentication("pwa-handoff-123456", "/vaults");
      throw new Error("synthetic network failure after the other window completed");
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

    expect(navigate).toHaveBeenCalledWith("/vaults");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("distinguishes publishing failure from an invalid magic link", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.redeemPwaMagicLink.mockResolvedValueOnce({
      refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
      returnPath: "/vaults",
    });
    mocks.publishPwaAuthenticationHandoff.mockRejectedValueOnce(new Error("unavailable"));
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa" }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sesi masuk tidak dapat diteruskan");
    expect(container.textContent).not.toContain("tidak valid atau sudah kedaluwarsa");
    expect(window.location.hash).toBe("");
  });

  it("fails closed before redemption when a standalone verifier is lost", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&handoff=pwa-handoff-123456",
    );
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestPwaAuthenticationVerifier.mockResolvedValueOnce(null);
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(MagicLinkConfirmation, { client: "pwa" }));
    });
    expect(mocks.redeemPwaMagicLink).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sesi masuk tidak dapat diteruskan");
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

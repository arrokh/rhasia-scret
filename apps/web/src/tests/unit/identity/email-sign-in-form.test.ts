/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => {
  let pwaAuthenticationCompletionListener: ((handoffId: string, returnPath: string) => void) | undefined;
  let pwaAuthenticationVerifierRequestListener: ((handoffId: string) => string | null) | undefined;
  return {
    announceAuthenticationCompletion: vi.fn(),
    announcePwaAuthenticationCompletion: vi.fn(),
    captureAnalyticsEvent: vi.fn(),
    clearPwaAuthenticationHandoff: vi.fn(),
    clearPwaAuthenticationProvisionalHandoff: vi.fn(),
    client: {},
    createPwaAuthenticationHandoff: vi.fn(() => ({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) })),
    isPwaDisplayMode: vi.fn(() => false),
    pollPwaAuthenticationHandoff: vi.fn(),
    readPwaAuthenticationHandoff: vi.fn((): { handoffId: string; verifier: string } | null => null),
    readPwaAuthenticationHandoffExpiresAt: vi.fn((): number | null => null),
    readProvisionalPwaAuthenticationHandoff: vi.fn(
      (): { handoff: { handoffId: string; verifier: string }; expiresAt: number } | null => null,
    ),
    storePwaAuthenticationHandoff: vi.fn(),
    storeProvisionalPwaAuthenticationHandoff: vi.fn(),
    requestEmailSignInLink: vi.fn(),
    subscribeToPwaAuthenticationCompletion: vi.fn((onComplete: (handoffId: string, returnPath: string) => void) => {
      pwaAuthenticationCompletionListener = onComplete;
      return () => {
        if (pwaAuthenticationCompletionListener === onComplete) pwaAuthenticationCompletionListener = undefined;
      };
    }),
    subscribeToPwaAuthenticationVerifierRequests: vi.fn((getVerifier: (handoffId: string) => string | null) => {
      pwaAuthenticationVerifierRequestListener = getVerifier;
      return () => {
        if (pwaAuthenticationVerifierRequestListener === getVerifier)
          pwaAuthenticationVerifierRequestListener = undefined;
      };
    }),
    requestVerifier(handoffId: string) {
      return pwaAuthenticationVerifierRequestListener?.(handoffId) ?? null;
    },
    completePwaAuthentication(handoffId: string, returnPath: string) {
      pwaAuthenticationCompletionListener?.(handoffId, returnPath);
    },
  };
});

vi.mock("@/modules/identity/infrastructure/browser-passwordless-client", () => ({
  browserPasswordlessClient: mocks.client,
  pollPwaAuthenticationHandoff: mocks.pollPwaAuthenticationHandoff,
}));
vi.mock("@/modules/identity/presentation/request-email-sign-in-link", () => ({
  authConfirmationRedirectUrl: (origin: string) => `${origin}/auth/confirm`,
  requestEmailSignInLink: mocks.requestEmailSignInLink,
}));
vi.mock("@/modules/identity/infrastructure/pwa-authentication", () => ({
  announcePwaAuthenticationCompletion: mocks.announcePwaAuthenticationCompletion,
  clearPwaAuthenticationHandoff: mocks.clearPwaAuthenticationHandoff,
  clearPwaAuthenticationProvisionalHandoff: mocks.clearPwaAuthenticationProvisionalHandoff,
  createPwaAuthenticationHandoff: mocks.createPwaAuthenticationHandoff,
  isPwaDisplayMode: mocks.isPwaDisplayMode,
  readPwaAuthenticationHandoff: mocks.readPwaAuthenticationHandoff,
  readPwaAuthenticationHandoffExpiresAt: mocks.readPwaAuthenticationHandoffExpiresAt,
  readProvisionalPwaAuthenticationHandoff: mocks.readProvisionalPwaAuthenticationHandoff,
  storePwaAuthenticationHandoff: mocks.storePwaAuthenticationHandoff,
  storeProvisionalPwaAuthenticationHandoff: mocks.storeProvisionalPwaAuthenticationHandoff,
  subscribeToPwaAuthenticationCompletion: mocks.subscribeToPwaAuthenticationCompletion,
  subscribeToPwaAuthenticationVerifierRequests: mocks.subscribeToPwaAuthenticationVerifierRequests,
}));
vi.mock("@/modules/identity/presentation/auth-completion-channel", () => ({
  announceAuthenticationCompletion: mocks.announceAuthenticationCompletion,
}));
vi.mock("@/shared/infrastructure/browser-analytics", () => ({ captureAnalyticsEvent: mocks.captureAnalyticsEvent }));

import { AUTH_COMPLETION_PATH } from "@/modules/identity/application/auth-return-path";
import { EmailSignInForm } from "@/modules/identity/presentation/email-sign-in-form";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

describe("EmailSignInForm", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.createPwaAuthenticationHandoff
      .mockReset()
      .mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.requestEmailSignInLink.mockReset();
    mocks.pollPwaAuthenticationHandoff.mockReset();
    mocks.announcePwaAuthenticationCompletion.mockReset();
    mocks.announceAuthenticationCompletion.mockReset();
    mocks.isPwaDisplayMode.mockReturnValue(false);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(null);
    mocks.readProvisionalPwaAuthenticationHandoff.mockReturnValue(null);
  });

  it("renders accessible TanStack validation warnings and blocks invalid submissions", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));

    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => form?.requestSubmit());

    const input = container.querySelector<HTMLInputElement>("#email");
    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(form?.noValidate).toBe(true);
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe("email-error");
    expect(alert?.textContent).toBe("Alamat email wajib diisi.");
    expect(mocks.requestEmailSignInLink).not.toHaveBeenCalled();

    await act(async () => setInputValue(input, "not-an-email"));
    await act(async () => form?.requestSubmit());

    expect(container.querySelector<HTMLElement>('[role="alert"]')?.textContent).toBe(
      "Masukkan alamat email yang valid.",
    );
    expect(mocks.requestEmailSignInLink).not.toHaveBeenCalled();
  });

  it("records provider-accepted and rate-limited sign-in link requests without the email", async () => {
    mocks.requestEmailSignInLink
      .mockResolvedValueOnce({ status: "sent" })
      .mockResolvedValueOnce({ status: "rate_limited" });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));

    const form = container.querySelector<HTMLFormElement>("form");
    const input = container.querySelector<HTMLInputElement>("#email");
    await act(async () => setInputValue(input, "person@example.test"));
    await act(async () => form?.requestSubmit());
    expect(mocks.captureAnalyticsEvent).toHaveBeenCalledWith(ANALYTICS_EVENTS.authenticationSignInLinkRequested, {
      method: "email",
    });
    expect(mocks.captureAnalyticsEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: expect.anything() }),
    );

    await act(async () => form?.requestSubmit());
    expect(mocks.captureAnalyticsEvent).toHaveBeenCalledWith(ANALYTICS_EVENTS.authenticationSignInLinkRequestFailed, {
      method: "email",
      failure_code: "rate_limited",
    });
  });

  it("requests a PWA handoff and accepts it when the browser publishes the session", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({
      accepted: true,
      returnPath: "/vaults/invitations/redeem",
    });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));

    const form = container.querySelector<HTMLFormElement>("form");
    const input = container.querySelector<HTMLInputElement>("#email");
    await act(async () => setInputValue(input, "person@example.test"));
    await act(async () => form?.requestSubmit());
    await act(async () => Promise.resolve());

    expect(mocks.requestEmailSignInLink).toHaveBeenCalledWith(mocks.client, "person@example.test", "/vaults", {
      client: "pwa",
      handoffId: "pwa-handoff-123456",
      handoffVerifier: "v".repeat(43),
    });
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledWith({
      handoffId: "pwa-handoff-123456",
      verifier: "v".repeat(43),
    });
    expect(mocks.storePwaAuthenticationHandoff).toHaveBeenCalledWith(
      { handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) },
      1_800_000_900_000,
    );
    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalledWith();
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(mocks.announcePwaAuthenticationCompletion).toHaveBeenCalledWith(
      "pwa-handoff-123456",
      "/vaults/invitations/redeem",
    );
    expect(navigate).toHaveBeenCalledWith(AUTH_COMPLETION_PATH);
  });

  it("navigates after server acceptance when the completion announcement fails", async () => {
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({ accepted: true, returnPath: "/vaults" });
    mocks.announcePwaAuthenticationCompletion.mockImplementationOnce(() => {
      throw new Error("synthetic PWA announcement failure");
    });
    mocks.announceAuthenticationCompletion.mockImplementationOnce(() => {
      throw new Error("synthetic session announcement failure");
    });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await act(async () => Promise.resolve());

    expect(navigate).toHaveBeenCalledWith("/vaults");
  });

  it("answers verifier requests while the PWA sign-in request is still pending", async () => {
    let resolveRequest: ((result: { status: "sent"; challengeExpiresInSeconds: number }) => void) | undefined;
    const request = new Promise<{ status: "sent"; challengeExpiresInSeconds: number }>((resolve) => {
      resolveRequest = resolve;
    });
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockReturnValueOnce(request);
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.requestEmailSignInLink).toHaveBeenCalledOnce();
    expect(mocks.storeProvisionalPwaAuthenticationHandoff).toHaveBeenCalledWith(
      { handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) },
      expect.any(Number),
    );
    expect(mocks.requestVerifier("pwa-handoff-123456")).toBe("v".repeat(43));

    await act(async () => {
      resolveRequest?.({ status: "sent", challengeExpiresInSeconds: 900 });
      await request;
    });
  });

  it("polls a provisional handoff while the API response is pending", async () => {
    let resolveRequest: ((result: { status: "error"; definitivelyRejected: false }) => void) | undefined;
    const request = new Promise<{ status: "error"; definitivelyRejected: false }>((resolve) => {
      resolveRequest = resolve;
    });
    const handoff = { handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) };
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockReturnValueOnce(request);
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({ accepted: true, returnPath: "/vaults" });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));

    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    await act(async () => Promise.resolve());
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/vaults"));

    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledWith(handoff);
    expect(mocks.announcePwaAuthenticationCompletion).toHaveBeenCalledWith(handoff.handoffId, "/vaults");
    expect(mocks.storePwaAuthenticationHandoff).not.toHaveBeenCalled();

    await act(async () => {
      resolveRequest?.({ status: "error", definitivelyRejected: false });
      await request;
    });
  });

  it("resumes a provisional handoff after reload without replacing the prior handoff", async () => {
    const provisionalHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    const expiresAt = Date.now() + 600_000;
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.readProvisionalPwaAuthenticationHandoff.mockReturnValue({ handoff: provisionalHandoff, expiresAt });
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(expiresAt);
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => Promise.resolve());

    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledWith(provisionalHandoff);
    expect(mocks.storePwaAuthenticationHandoff).not.toHaveBeenCalled();
  });

  it("answers verifier requests from the active in-memory handoff when storage is unavailable", async () => {
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.readPwaAuthenticationHandoff).toHaveReturnedWith(null);
    expect(mocks.requestVerifier("pwa-handoff-123456")).toBe("v".repeat(43));
  });

  it("uses the accepted path when another PWA window completes the invitation handoff", async () => {
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));
    await act(async () => Promise.resolve());

    await act(async () => {
      mocks.completePwaAuthentication("pwa-handoff-123456", "/vaults/invitations/redeem");
      mocks.completePwaAuthentication("pwa-handoff-123456", "/vaults/invitations/redeem");
    });

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(AUTH_COMPLETION_PATH);
    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalledWith();
  });

  it("retains an ambiguous replacement verifier without overwriting the previous valid handoff", async () => {
    const previousHandoff = { handoffId: "pwa-handoff-old-123", verifier: "p".repeat(43) };
    const provisionalHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(previousHandoff);
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(1_900_000_000_000);
    mocks.createPwaAuthenticationHandoff.mockReturnValueOnce(provisionalHandoff);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "error", definitivelyRejected: false });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.storePwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(mocks.storeProvisionalPwaAuthenticationHandoff).toHaveBeenCalledWith(provisionalHandoff, expect.any(Number));
    expect(mocks.clearPwaAuthenticationProvisionalHandoff).not.toHaveBeenCalled();
    expect(mocks.requestVerifier(previousHandoff.handoffId)).toBe(previousHandoff.verifier);
    expect(mocks.requestVerifier(provisionalHandoff.handoffId)).toBe(provisionalHandoff.verifier);
  });

  it("keeps a valid PWA handoff when a replacement request is rate limited", async () => {
    const previousHandoff = { handoffId: "pwa-handoff-old-123", verifier: "p".repeat(43) };
    const replacementHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(previousHandoff);
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(1_900_000_000_000);
    mocks.createPwaAuthenticationHandoff.mockReturnValueOnce(replacementHandoff);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "rate_limited" });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.requestEmailSignInLink).toHaveBeenCalledWith(mocks.client, "person@example.test", "/vaults", {
      client: "pwa",
      handoffId: replacementHandoff.handoffId,
      handoffVerifier: replacementHandoff.verifier,
    });
    expect(mocks.clearPwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(mocks.clearPwaAuthenticationProvisionalHandoff).toHaveBeenCalledWith(replacementHandoff.handoffId);
    expect(mocks.storePwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledWith(previousHandoff);
    expect(mocks.requestVerifier(previousHandoff.handoffId)).toBe(previousHandoff.verifier);
    expect(mocks.requestVerifier(replacementHandoff.handoffId)).toBeNull();
  });

  it("clears a provisional handoff after a definite client rejection", async () => {
    const previousHandoff = { handoffId: "pwa-handoff-old-123", verifier: "p".repeat(43) };
    const rejectedHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(previousHandoff);
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(1_900_000_000_000);
    mocks.createPwaAuthenticationHandoff.mockReturnValueOnce(rejectedHandoff);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "error", definitivelyRejected: true });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.clearPwaAuthenticationProvisionalHandoff).toHaveBeenCalledWith(rejectedHandoff.handoffId);
    expect(mocks.clearPwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(mocks.requestVerifier(previousHandoff.handoffId)).toBe(previousHandoff.verifier);
    expect(mocks.requestVerifier(rejectedHandoff.handoffId)).toBeNull();
  });

  it("completes an accepted poll even when a replacement handoff was activated", async () => {
    const previousHandoff = { handoffId: "pwa-handoff-old-123", verifier: "p".repeat(43) };
    const replacementHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    let resolvePreviousPoll: ((result: { accepted: true; returnPath: "/vaults" }) => void) | undefined;
    const previousPoll = new Promise<{ accepted: true; returnPath: "/vaults" }>((resolve) => {
      resolvePreviousPoll = resolve;
    });
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.createPwaAuthenticationHandoff.mockReturnValueOnce(previousHandoff).mockReturnValueOnce(replacementHandoff);
    mocks.requestEmailSignInLink
      .mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 })
      .mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockReturnValueOnce(previousPoll).mockResolvedValue({ pending: true });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => form?.requestSubmit());
    await act(async () => form?.requestSubmit());

    await act(async () => {
      resolvePreviousPoll?.({ accepted: true, returnPath: "/vaults" });
      await previousPoll;
    });

    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalledWith();
    expect(mocks.storePwaAuthenticationHandoff).toHaveBeenCalledWith(replacementHandoff, expect.any(Number));
    expect(mocks.requestVerifier(replacementHandoff.handoffId)).toBeNull();
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/vaults");
  });

  it("clears and announces an accepted handoff when polling resolves after unmount", async () => {
    let resolveAcceptedPoll: ((result: { accepted: true; returnPath: "/vaults" }) => void) | undefined;
    const acceptedPoll = new Promise<{ accepted: true; returnPath: "/vaults" }>((resolve) => {
      resolveAcceptedPoll = resolve;
    });
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockReturnValueOnce(acceptedPoll);
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledOnce();

    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => {
      resolveAcceptedPoll?.({ accepted: true, returnPath: "/vaults" });
      await acceptedPoll;
    });

    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalledWith();
    expect(mocks.announcePwaAuthenticationCompletion).toHaveBeenCalledWith("pwa-handoff-123456", "/vaults");
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("backs off polling and pauses while the installed app is hidden", async () => {
    vi.useFakeTimers();
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(4);
  });

  it("expires a resumed provisional handoff without showing a false handoff failure", async () => {
    vi.useFakeTimers();
    const provisionalHandoff = { handoffId: "pwa-handoff-new-123", verifier: "n".repeat(43) };
    const expiresAt = Date.now() + 3_000;
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.readProvisionalPwaAuthenticationHandoff.mockReturnValue({ handoff: provisionalHandoff, expiresAt });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));
    expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(3_000));

    expect(mocks.clearPwaAuthenticationProvisionalHandoff).toHaveBeenCalledWith(provisionalHandoff.handoffId);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not return an expired active verifier to another PWA window", async () => {
    const handoff = { handoffId: "pwa-handoff-old-123", verifier: "p".repeat(43) };
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(handoff);
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(Date.now() - 1);
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));

    expect(mocks.requestVerifier(handoff.handoffId)).toBeNull();
    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalledWith(handoff.handoffId);
  });

  it("stays quiet when the expired active handoff has already been discarded", async () => {
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
    mocks.readPwaAuthenticationHandoffExpiresAt.mockReturnValue(null);
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));

    expect(mocks.pollPwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(mocks.clearPwaAuthenticationHandoff).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("defaults an unrecognized PWA handoff return path to the vault directory", async () => {
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
    mocks.pollPwaAuthenticationHandoff.mockResolvedValueOnce({
      accepted: true,
      returnPath: "https://example.invalid/",
    });
    const navigate = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { navigate })));

    const form = container.querySelector<HTMLFormElement>("form");
    const input = container.querySelector<HTMLInputElement>("#email");
    await act(async () => setInputValue(input, "person@example.test"));
    await act(async () => form?.requestSubmit());
    await act(async () => Promise.resolve());

    expect(navigate).toHaveBeenCalledWith("/vaults");
  });

  it.each(["pageshow", "online", "visibilitychange"])(
    "polls immediately on %s without overlapping requests and removes listeners on unmount",
    async (eventName) => {
      mocks.isPwaDisplayMode.mockReturnValue(true);
      mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent", challengeExpiresInSeconds: 900 });
      mocks.pollPwaAuthenticationHandoff.mockResolvedValue({ pending: true });
      const container = document.createElement("div");
      root = createRoot(container);
      await act(async () => root?.render(createElement(EmailSignInForm)));
      await act(async () => setInputValue(container.querySelector("#email"), "person@example.test"));
      await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
      const initialCalls = mocks.pollPwaAuthenticationHandoff.mock.calls.length;
      mocks.pollPwaAuthenticationHandoff.mockReturnValueOnce(new Promise(() => undefined));
      const eventTarget = eventName === "visibilitychange" ? document : window;
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      await act(async () => eventTarget.dispatchEvent(new Event(eventName)));
      expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(initialCalls + 1);
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(initialCalls + 1);
      await act(async () => root?.unmount());
      root = undefined;
      eventTarget.dispatchEvent(new Event(eventName));
      expect(mocks.pollPwaAuthenticationHandoff).toHaveBeenCalledTimes(initialCalls + 1);
    },
  );

  it("passes the invitation return path without carrying the fragment into authentication", async () => {
    mocks.requestEmailSignInLink.mockResolvedValueOnce({ status: "sent" });
    window.history.replaceState(null, "", "/sign-in?auth=required&next=%2Fvaults%2Finvitations%2Fredeem#secret");
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm, { nextPath: "/vaults/invitations/redeem" })));

    const form = container.querySelector<HTMLFormElement>("form");
    const input = container.querySelector<HTMLInputElement>("#email");
    await act(async () => setInputValue(input, "person@example.test"));
    await act(async () => form?.requestSubmit());

    expect(window.location.hash).toBe("");
    expect(mocks.requestEmailSignInLink).toHaveBeenCalledWith(
      mocks.client,
      "person@example.test",
      "/vaults/invitations/redeem",
    );
    expect(document.cookie).toContain("rhsia-auth-return-path=%2Fvaults%2Finvitations%2Fredeem");
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected email input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

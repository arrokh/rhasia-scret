/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  announceAuthenticationCompletion: vi.fn(),
  captureAnalyticsEvent: vi.fn(),
  clearPwaAuthenticationHandoff: vi.fn(),
  client: {},
  createPwaAuthenticationHandoff: vi.fn(() => ({ handoffId: "pwa-handoff-123456", verifier: "v".repeat(43) })),
  isPwaDisplayMode: vi.fn(() => false),
  pollPwaAuthenticationHandoff: vi.fn(),
  readPwaAuthenticationHandoff: vi.fn(() => null),
  requestEmailSignInLink: vi.fn(),
}));

vi.mock("@/modules/identity/infrastructure/browser-passwordless-client", () => ({
  browserPasswordlessClient: mocks.client,
  pollPwaAuthenticationHandoff: mocks.pollPwaAuthenticationHandoff,
}));
vi.mock("@/modules/identity/presentation/request-email-sign-in-link", () => ({
  authConfirmationRedirectUrl: (origin: string) => `${origin}/auth/confirm`,
  requestEmailSignInLink: mocks.requestEmailSignInLink,
}));
vi.mock("@/modules/identity/infrastructure/pwa-authentication", () => ({
  clearPwaAuthenticationHandoff: mocks.clearPwaAuthenticationHandoff,
  createPwaAuthenticationHandoff: mocks.createPwaAuthenticationHandoff,
  isPwaDisplayMode: mocks.isPwaDisplayMode,
  readPwaAuthenticationHandoff: mocks.readPwaAuthenticationHandoff,
}));
vi.mock("@/modules/identity/presentation/auth-completion-channel", () => ({
  announceAuthenticationCompletion: mocks.announceAuthenticationCompletion,
}));
vi.mock("@/shared/infrastructure/browser-analytics", () => ({ captureAnalyticsEvent: mocks.captureAnalyticsEvent }));

import { EmailSignInForm } from "@/modules/identity/presentation/email-sign-in-form";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";

describe("EmailSignInForm", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.clearAllMocks();
    mocks.isPwaDisplayMode.mockReturnValue(false);
    mocks.readPwaAuthenticationHandoff.mockReturnValue(null);
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
    mocks.requestEmailSignInLink.mockResolvedValueOnce("sent").mockResolvedValueOnce("rate_limited");
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
    mocks.isPwaDisplayMode.mockReturnValue(true);
    mocks.requestEmailSignInLink.mockResolvedValueOnce("sent");
    mocks.pollPwaAuthenticationHandoff.mockResolvedValue({
      accepted: true,
      returnPath: "/vaults/invitations/redeem",
    });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(EmailSignInForm)));

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
    expect(mocks.clearPwaAuthenticationHandoff).toHaveBeenCalled();
    expect(mocks.announceAuthenticationCompletion).toHaveBeenCalledOnce();
  });

  it("passes the invitation return path without carrying the fragment into authentication", async () => {
    mocks.requestEmailSignInLink.mockResolvedValueOnce("sent");
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

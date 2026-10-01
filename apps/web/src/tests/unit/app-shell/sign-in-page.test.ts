import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadServerVaultPageContext: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/infrastructure/server-api-gateway", () => ({
  loadServerVaultPageContext: mocks.loadServerVaultPageContext,
  isServerApiConfigurationError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "name" in error && error.name === "ServerApiConfigurationError"),
  isServerApiUnavailableError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "name" in error && error.name === "ServerApiUnavailableError"),
}));
vi.mock("@/modules/identity/presentation/email-sign-in-form", () => ({
  EmailSignInForm: ({ nextPath, turnstileSiteKey }: { nextPath: string; turnstileSiteKey?: string }) =>
    createElement("form", {
      "aria-label": "Formulir masuk",
      "data-next-path": nextPath,
      "data-turnstile-site-key": turnstileSiteKey,
    }),
}));

import SignInPage from "@/app/sign-in/page";

beforeEach(() => {
  vi.stubEnv("AUTH_BACKEND", "passwordless");
  vi.stubEnv("AUTH_APP_ORIGIN", "https://app.example.test");
  vi.stubEnv("AUTH_MAGIC_LINK_SECRET", "synthetic-magic-link-secret-32-characters");
  vi.stubEnv("AUTH_SESSION_SECRET", "synthetic-session-secret-32-characters");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "synthetic-turnstile-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "synthetic-turnstile-secret-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SignInPage", () => {
  it("redirects an authenticated user to their vaults", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue({
      user: { id: "user", email: "user@example.test", status: "ACTIVE" },
    });
    await SignInPage({ searchParams: Promise.resolve({}) });
    expect(mocks.redirect).toHaveBeenCalledWith("/vaults");
  });

  it("returns an authenticated invitation recipient to redemption", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue({
      user: { id: "user", email: "user@example.test", status: "ACTIVE" },
    });
    await SignInPage({ searchParams: Promise.resolve({ next: "/vaults/invitations/redeem" }) });
    expect(mocks.redirect).toHaveBeenCalledWith("/vaults/invitations/redeem");
  });

  it("keeps sign in public when the API has no authenticated user", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue(null);
    await SignInPage({ searchParams: Promise.resolve({}) });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("passes the runtime Turnstile site key to the passwordless sign-in form", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "synthetic-runtime-turnstile-site-key");

    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain('data-turnstile-site-key="synthetic-runtime-turnstile-site-key"');
  });

  it("does not query the hosted API in explicit local-only mode", async () => {
    vi.stubEnv("AUTH_BACKEND", "none");
    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(mocks.loadServerVaultPageContext).not.toHaveBeenCalled();
    expect(markup).toContain("Autentikasi jarak jauh dinonaktifkan. Gunakan Brankas Lokal.");
    expect(markup).not.toContain('aria-label="Formulir masuk"');
    expect(markup).toContain('href="/local"');
    expect(markup).toContain('href="/offline"');
  });

  it("renders a localized configuration state for invalid web configuration", async () => {
    vi.stubEnv("AUTH_BACKEND", "invalid-backend");
    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(mocks.loadServerVaultPageContext).not.toHaveBeenCalled();
    expect(markup).toContain("Layanan masuk belum dikonfigurasi. Hubungi administrator.");
    expect(markup).not.toContain("Formulir masuk");
  });

  it("maps the stable API configuration error to the localized sign-in state", async () => {
    mocks.loadServerVaultPageContext.mockRejectedValue({ name: "ServerApiConfigurationError" });
    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("Layanan masuk belum dikonfigurasi. Hubungi administrator.");
    expect(markup).not.toContain("Formulir masuk");
  });

  it("renders a localized temporary-unavailability notice when the API user lookup fails", async () => {
    mocks.loadServerVaultPageContext.mockRejectedValue(
      Object.assign(new Error("Hosted API is temporarily unavailable."), { name: "ServerApiUnavailableError" }),
    );
    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain(
      "Akses Brankas Hosted sedang tidak tersedia. Coba lagi nanti atau gunakan Brankas Lokal/snapshot luring.",
    );
    expect(markup).toContain('href="/local"');
    expect(markup).toContain('href="/offline"');
    expect(markup).toContain('aria-label="Formulir masuk"');
    expect(markup).not.toContain("API user lookup failed.");
  });

  it("does not hide unexpected programming errors as API outages", async () => {
    mocks.loadServerVaultPageContext.mockRejectedValue(new Error("unexpected failure"));

    await expect(SignInPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("unexpected failure");
  });

  it("preserves logout notices, email sign in, and offline access", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue(null);
    const page = await SignInPage({ searchParams: Promise.resolve({ auth: ["signed_out", "ignored"] }) });
    const markup = renderToStaticMarkup(createElement("div", null, page));
    expect(markup).toContain("Anda telah keluar.");
    expect(markup).toContain('aria-label="Formulir masuk"');
    expect(markup).toContain('href="/offline"');
    expect(markup).toContain("Masuk atau buat akun dengan alamat email terverifikasi.");
  });
});

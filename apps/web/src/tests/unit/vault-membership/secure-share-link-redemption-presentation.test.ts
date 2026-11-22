/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import idMessages from "../../../../messages/id.json";
import { SecureShareLinkRedemption, SecureShareLinkSecretProvider } from "@/modules/vault-membership";

const mocks = vi.hoisted(() => ({ redeemSecureShareLink: vi.fn() }));
vi.mock("@/modules/vault-membership/infrastructure/browser-secure-share-link-workflow", () => ({
  redeemSecureShareLink: mocks.redeemSecureShareLink,
}));
vi.unmock("next-intl");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const TestIntlProvider = NextIntlClientProvider as ComponentType<{
  locale: "id" | "en";
  messages: typeof idMessages;
  children?: ReactNode;
}>;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("Secure Share Link redemption presentation", () => {
  it("does not drop a new invitation when an earlier redemption completes", async () => {
    const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) };
    let resolveRedemption: (() => void) | undefined;
    const redemption = new Promise<void>((resolve) => {
      resolveRedemption = resolve;
    });
    mocks.redeemSecureShareLink.mockReturnValueOnce(redemption);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");
    await act(async () =>
      root?.render(
        createElement(
          TestIntlProvider,
          { locale: "id", messages: idMessages },
          createElement(
            SecureShareLinkSecretProvider,
            null,
            createElement(SecureShareLinkRedemption, { profileId: "profile-1", userEncryptionPublicKey: publicKey }),
          ),
        ),
      ),
    );

    const redeemButton = [...container.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find((button) =>
      button.textContent?.includes("Terima undangan"),
    );
    await act(async () => redeemButton?.click());
    await vi.waitFor(() => expect(mocks.redeemSecureShareLink).toHaveBeenCalledOnce());

    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000001");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(window.location.hash).toBe("");

    await act(async () => {
      resolveRedemption?.();
      await redemption;
    });

    expect(window.location.pathname).toBe("/vaults/invitations/redeem");
    expect(container.textContent).toContain("Undangan sebelumnya telah diterima");
    expect(container.textContent).toContain("Terima undangan");
  });

  it("preserves redemption state across unrelated hash changes", async () => {
    const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) };
    let rejectRedemption: ((reason: Error) => void) | undefined;
    const redemption = new Promise<never>((_, reject) => {
      rejectRedemption = reject;
    });
    mocks.redeemSecureShareLink.mockReturnValueOnce(redemption);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    window.history.replaceState(null, "", "/vaults/invitations/redeem#synthetic-secure-share-link-secret-00000000");
    await act(async () =>
      root?.render(
        createElement(
          TestIntlProvider,
          { locale: "id", messages: idMessages },
          createElement(
            SecureShareLinkSecretProvider,
            null,
            createElement(SecureShareLinkRedemption, { profileId: "profile-1", userEncryptionPublicKey: publicKey }),
          ),
        ),
      ),
    );

    const redeemButton = [...container.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find((button) =>
      button.textContent?.includes("Terima undangan"),
    );
    expect(window.location.hash).toBe("");
    expect(redeemButton?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="Buka panduan: Undangan Brankas Bersama"]')).not.toBeNull();

    await act(async () => {
      redeemButton?.click();
      await vi.waitFor(() => expect(mocks.redeemSecureShareLink).toHaveBeenCalledOnce());
    });

    expect(redeemButton?.disabled).toBe(true);
    window.history.replaceState(null, "", "/vaults/invitations/redeem#account-settings-security-notice");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(redeemButton?.disabled).toBe(true);
    expect(window.location.hash).toBe("#account-settings-security-notice");

    await act(async () => {
      rejectRedemption?.(new Error("synthetic transport failure"));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(mocks.redeemSecureShareLink).toHaveBeenCalledWith("synthetic-secure-share-link-secret-00000000", {
      profileId: "profile-1",
      publicKey,
    });
    expect(container.textContent).toContain("buka kembali tautan undangan asli");

    window.history.replaceState(null, "", "/vaults/invitations/redeem#another-section");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(redeemButton?.disabled).toBe(false);
  });
});

/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ generateTotp: vi.fn().mockResolvedValue({ value: "123456", validUntil: new Date(Date.now() + 30_000) }), writeText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@rhasia-scret/client-vault-core", () => ({ generateTotp: mocks.generateTotp }));
vi.mock("@/modules/otp-runtime/infrastructure/browser-hmac-generator", () => ({ BrowserHmacGenerator: class BrowserHmacGenerator {} }));
import { TotpAccountButton } from "@/modules/otp-runtime/presentation/totp-account-button";

describe("TotpAccountButton", () => {
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("offers an explicit, accessible account-management action", async () => {
    const onManage = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TotpAccountButton, { configuration: configuration(), vaultName: "Brankas Pribadi", onManage })));
    const manage = container.querySelector<HTMLButtonElement>('[aria-label="Kelola Alice"]');
    expect(manage).not.toBeNull();
    await act(async () => manage?.click());
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("generates an OTP locally and copies it from the shadcn account card", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
    const onAccess = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TotpAccountButton, { configuration: configuration(), vaultName: "Brankas Pribadi", onAccess })));
    expect(container.textContent).toContain("123 456");
    expect(container.textContent).toContain("OTPAuth");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("Brankas Pribadi");
    expect(container.querySelector('article svg circle[stroke-dasharray="100"]')).not.toBeNull();
    const copy = container.querySelector<HTMLButtonElement>('[aria-label^="Salin OTP"]');
    await act(async () => copy?.click());
    expect(mocks.writeText).toHaveBeenCalledWith("123456");
    expect(onAccess).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Disalin");
    expect(container.querySelector(".lucide-check")).not.toBeNull();
    expect(container.querySelector("circle.stroke-success")).not.toBeNull();
    const card = container.querySelector("article");
    expect(card?.getAttribute("data-shaking")).toBe("true");
    expect(container.querySelector(".lucide-copy")).toBeNull();
    await act(async () => card?.dispatchEvent(new Event("animationend", { bubbles: true })));
    expect(card?.hasAttribute("data-shaking")).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(container.textContent).not.toContain("Disalin");
    expect(container.querySelector(".lucide-check")).toBeNull();
    expect(container.querySelector("circle.stroke-success")).toBeNull();
  });

  it("pauses the shared clock while hidden and resynchronizes on visibility", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(TotpAccountButton, { configuration: configuration(), vaultName: "Brankas Pribadi" })));
    expect(mocks.generateTotp).toHaveBeenCalledOnce();

    visibility.mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.generateTotp).toHaveBeenCalledOnce();

    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.generateTotp).toHaveBeenCalledTimes(2);
  });

  it("shares one clock and signs only when the TOTP counter changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement("div", null,
      ...Array.from({ length: 100 }, (_, index) => createElement(TotpAccountButton, {
        key: index,
        configuration: { ...configuration(), accountName: `Account ${index}` },
        vaultName: "Brankas Pribadi"
      }))
    )));

    expect(mocks.generateTotp).toHaveBeenCalledTimes(100);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(mocks.generateTotp).toHaveBeenCalledTimes(100);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.generateTotp).toHaveBeenCalledTimes(200);
  }, 15_000);
});

function configuration() { return { issuer: "OTPAuth", accountName: "Alice", secret: Uint8Array.of(1), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 }; }

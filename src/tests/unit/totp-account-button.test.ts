/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ generateTotp: vi.fn().mockResolvedValue({ value: "123456", validUntil: new Date(Date.now() + 30_000) }), writeText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/modules/otp-runtime/application/generate-totp", () => ({ generateTotp: mocks.generateTotp }));
vi.mock("@/modules/otp-runtime/infrastructure/browser-hmac-generator", () => ({ BrowserHmacGenerator: class BrowserHmacGenerator {} }));
import { TotpAccountButton } from "@/modules/otp-runtime/presentation/totp-account-button";

describe("TotpAccountButton", () => {
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

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
});

function configuration() { return { issuer: "OTPAuth", accountName: "Alice", secret: Uint8Array.of(1), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 }; }
